const scaleMap = {
  10: '1', 20: '2', 30: '3', 40: '4',
  45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7'
};

// 拡張機能のインストール・更新時に1分ごとの定期監視アラームをセット
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkQuakeAlarm', { periodInMinutes: 1 });
  checkLatestQuake();
});

// アラーム発火時に最新地震をチェック
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkQuakeAlarm') {
    checkLatestQuake();
  }
});

async function checkLatestQuake() {
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

    // 前回通知済みのIDと比較
    const stored = await chrome.storage.local.get(['lastNotifiedId']);
    if (stored.lastNotifiedId === latest.id) return;

    // 新しい地震であればIDを保存
    await chrome.storage.local.set({ lastNotifiedId: latest.id });

    // 初回起動直後の過去データには通知を出さない
    if (!stored.lastNotifiedId) return;

    const eq = latest.earthquake;
    const maxInt = scaleMap[eq.maxScale] || '-';
    const mag = eq.hypocenter.magnitude >= 0 ? eq.hypocenter.magnitude.toFixed(1) : '不明';

    // PCのデスクトップ通知を発行
    chrome.notifications.create(latest.id, {
      type: 'basic',
      iconUrl: 'icon.png',
      title: `【新着地震】${eq.hypocenter.name}（最大震度${maxInt}）`,
      message: `マグニチュード: M${mag} / 深さ: ${eq.hypocenter.depth}km\nクリックしてマップを起動します`,
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
