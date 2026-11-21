const scaleMap = {
  10: '1', 20: '2', 30: '3', 40: '4',
  45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7'
};

// 開く先のGitHub Pages URL（リポジトリ名 /Epc-Distribution/ まで含める）
const TARGET_MAP_URL = 'https://' + 'm-a-c-k-m-a.' + 'github.' + 'io' + '/Epc-Distribution/';

// 拡張機能のインストール・更新時に1分ごとの定期監視アラームをセット
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQuakeAlarm', { periodInMinutes: 1 });
  checkLatestQuake(true); // 更新直後は動作確認用にテスト通知を1回出す
});

// ブラウザ起動時にもアラームを再セット
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('checkQuakeAlarm', { periodInMinutes: 1 });
});

// アラーム発火時に最新地震をチェック
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkQuakeAlarm') {
    checkLatestQuake(false);
  }
});

async function checkLatestQuake(isTestOnReload = false) {
  try {
    const protocol = 'https://';
    const domain = 'api.' + 'p2pquake.' + 'net';
    const path = '/v2/history?codes=551&limit=5';
    const res = await fetch(protocol + domain + path);
    if (!res.ok) return;
    const list = await res.json();

    // 詳細電文(DetailScale)の最新1件を取得
    const latest = list.find(item => item.issue && item.issue.type === 'DetailScale');
    if (!latest) return;

    const stored = await chrome.storage.local.get(['lastNotifiedId']);

    // 更新直後のテストモードでなければ、すでに通知済みのIDはスキップ
    if (!isTestOnReload && stored.lastNotifiedId === latest.id) return;

    // 最新IDを保存
    await chrome.storage.local.set({ lastNotifiedId: latest.id });

    const eq = latest.earthquake;
    const maxInt = scaleMap[eq.maxScale] || '-';
    const mag = eq.hypocenter.magnitude >= 0 ? eq.hypocenter.magnitude.toFixed(1) : '不明';
    const prefix = isTestOnReload ? '【監視開始テスト】' : '【新着地震】';

    // PCのデスクトップ通知を発行
    chrome.notifications.create('quake_' + Date.now(), {
      type: 'basic',
      iconUrl: 'icon.png',
      title: `${prefix}${eq.hypocenter.name}（最大震度${maxInt}）`,
      message: `マグニチュード: M${mag} / 深さ: ${eq.hypocenter.depth}km\nクリックしてマップを開きます`,
      priority: 2
    });
  } catch (e) {
    console.error('バックグラウンド監視エラー:', e);
  }
}

// 通知がクリックされたら GitHub Pages のWebアプリを自動で開く
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: 'https://m-a-c-k-m-a.github.io/Epc-Distribution/' });
  chrome.notifications.clear(notificationId);
});
