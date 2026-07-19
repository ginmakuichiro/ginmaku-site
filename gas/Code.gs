/**
 * 銀幕一楼とTIMECAFE スケジュール管理システム (Google Apps Script)
 *
 * 仕組み:
 *   Googleフォーム入力 → onFormSubmit →
 *     公開日時が空 or 過去 → 即GitHubにコミット（サイト自動反映）
 *     公開日時が未来     → 保留リストに保存し、10分毎のトリガーが時刻到来分を自動公開
 *
 * セットアップ手順は同じフォルダの README.md を参照。
 */

const REPO = 'ginmakuichiro/ginmaku-site';
const FILE_PATH = 'data/schedule.json';
const TZ = 'Asia/Tokyo';

/* ================= 初回セットアップ ================= */

function setup() {
  const form = FormApp.create('銀幕一楼とTIMECAFE ライブ情報登録');
  form.setDescription('入力するとオフィシャルサイトのSCHEDULEに自動反映されます。\n「公開日時」を指定すると情報解禁までサイトに載りません。');

  form.addDateItem().setTitle('公演日').setRequired(true);
  form.addTextItem().setTitle('タイトル').setRequired(true);
  form.addTextItem().setTitle('会場').setRequired(true);
  form.addMultipleChoiceItem().setTitle('出演形態')
      .setChoiceValues(['バンド', '銀幕一楼ソロ']).setRequired(true);
  form.addTextItem().setTitle('OPEN（例 18:30）');
  form.addTextItem().setTitle('START（例 19:00）');
  form.addTextItem().setTitle('前売料金（数字のみ 例 3000）');
  form.addTextItem().setTitle('当日料金（数字のみ 例 3500）');
  form.addTextItem().setTitle('チケット/詳細リンク（URL）');
  form.addTextItem().setTitle('備考（例: +1drink600 / 学割あり）');
  form.addDateTimeItem().setTitle('公開日時（情報解禁。空欄なら即公開）');

  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('publishDue').timeBased().everyMinutes(10).create();

  Logger.log('フォームURL(入力用): ' + form.getPublishedUrl());
  Logger.log('フォームURL(編集用): ' + form.getEditUrl());
}

/* ================= フォーム受信 ================= */

function onFormSubmit(e) {
  const items = {};
  e.response.getItemResponses().forEach(r => items[r.getItem().getTitle()] = String(r.getResponse() || '').trim());

  const entry = {
    date:  items['公演日'],                                  // yyyy-MM-dd
    title: items['タイトル'],
    venue: items['会場'],
    type:  items['出演形態'] === 'バンド' ? 'band' : 'solo',
    open:  normTime(items['OPEN（例 18:30）']),
    start: normTime(items['START（例 19:00）']),
    adv:   items['前売料金（数字のみ 例 3000）'].replace(/[^0-9]/g, ''),
    door:  items['当日料金（数字のみ 例 3500）'].replace(/[^0-9]/g, ''),
    note:  items['備考（例: +1drink600 / 学割あり）'],
    link:  items['チケット/詳細リンク（URL）']
  };

  const publishAtStr = items['公開日時（情報解禁。空欄なら即公開）'];
  const publishAt = publishAtStr ? new Date(publishAtStr.replace(' ', 'T')) : null;

  if (publishAt && publishAt.getTime() > Date.now()) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('pending_' + Date.now(), JSON.stringify({ publishAt: publishAt.getTime(), entry }));
    notify('⏰ 公開予約を受け付けました', entry, publishAt);
  } else {
    publishEntry(entry);
    notify('✅ サイトに公開しました', entry, null);
  }
}

function normTime(s) {
  if (!s) return '';
  const m = s.match(/(\d{1,2})[:：時]?(\d{2})?/);
  return m ? (('0' + m[1]).slice(-2) + ':' + (m[2] || '00')) : s;
}

/* ================= 予約公開（10分毎） ================= */

function publishDue() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).filter(k => k.indexOf('pending_') === 0).forEach(key => {
    const item = JSON.parse(all[key]);
    if (item.publishAt <= Date.now()) {
      publishEntry(item.entry);
      props.deleteProperty(key);
      notify('✅ 予約公開しました', item.entry, null);
    }
  });
}

/* ================= GitHubコミット ================= */

function publishEntry(entry) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN が未設定です（プロジェクトの設定→スクリプト プロパティ）');
  const url = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE_PATH;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };

  const res = JSON.parse(UrlFetchApp.fetch(url, { headers }).getContentText());
  const list = JSON.parse(Utilities.newBlob(Utilities.base64Decode(res.content.replace(/\n/g, ''))).getDataAsString('UTF-8'));

  list.push(entry);
  list.sort((a, b) => a.date < b.date ? -1 : 1);

  const body = JSON.stringify(list, null, 2) + '\n';
  UrlFetchApp.fetch(url, {
    method: 'put',
    headers,
    contentType: 'application/json',
    payload: JSON.stringify({
      message: 'スケジュール追加: ' + entry.date + ' ' + entry.title,
      content: Utilities.base64Encode(body, Utilities.Charset.UTF_8),
      sha: res.sha
    })
  });
}

/* ================= 通知（フォーム所有者にメール） ================= */

function notify(subject, entry, publishAt) {
  const when = publishAt ? '\n公開予定: ' + Utilities.formatDate(publishAt, TZ, 'yyyy-MM-dd HH:mm') : '';
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
    '[銀幕サイト] ' + subject,
    entry.date + ' ' + entry.title + ' @' + entry.venue + when + '\n\nhttps://ginmakuichiro.net/#schedule');
}
