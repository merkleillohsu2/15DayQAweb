// bounce.js

export function initBounce({
  lotterySelector = '#lotteryImage',
  rewardSelector = '.reward-img',
  popupId = 'bouncePopup',
  iframeId = 'bounceIframe',
  closeSelector = '#closeBouncePopup',
  drawEvent = 'Draw_now'
} = {}) {
  const bouncePopup = document.getElementById(popupId);
  const bounceIframe = document.getElementById(iframeId);
  const closeBouncePopup = document.querySelector(closeSelector);
  const lotteryImage = document.querySelector(lotterySelector);
  const rewardImg = document.querySelector(rewardSelector);
  const taskId = getTaskIdFromPath();
  const bounceURL = `/lottery/bounce${window.location.search}${taskId ? `&taskId=${taskId}` : ''}`;

  function getTaskIdFromPath() {
    const path = window.location.pathname; // e.g. "/task/10"
    const segments = path.split('/');
    const taskId = segments.includes('task') ? segments[segments.indexOf('task') + 1] : null;
    return taskId;
  }

  function openBounce() {
    if (typeof navigateToParent === 'function') {
      navigateToParent(drawEvent);
    }
    bounceIframe.setAttribute('src', bounceURL);
    bouncePopup.classList.remove('hidden');

    // 禁用 lotteryImage 點擊
    // if (lotteryImage) {
    //   lotteryImage.style.pointerEvents = 'none'; // 禁止點擊
    //   lotteryImage.style.opacity = '0.5';        // 可選：視覺上淡化
    //   lotteryImage.classList.add('disabled');    // 可選：加上樣式 class
    // }

  }
  function openBounceReward() {
    if (typeof navigateToParent === 'function') {
      navigateToParent(drawEvent);
    }
    bounceIframe.setAttribute('src', bounceURL);
    bouncePopup.classList.remove('hidden');
  }
  window.addEventListener('message', (event) => {
    if (event.data === 'drawcompleted') {
      // 更新 rewardImg 圖片為已完成抽獎版本
      if (rewardImg) {
        rewardImg.setAttribute('src', '/images/點擊領取獎勵金popup-已完成抽獎.png');

        // 移除點擊事件
        rewardImg.replaceWith(rewardImg.cloneNode(true));
      }
    }
  });
  function closeBounce() {
    bouncePopup.classList.add('hidden');
    bounceIframe.setAttribute('src', '');
  }

  if (lotteryImage) {
    lotteryImage.addEventListener('click', openBounce);
  }

  if (rewardImg) {
    rewardImg.addEventListener('click', openBounceReward);
  }

  if (closeBouncePopup) {
    closeBouncePopup.addEventListener('click', closeBounce);
  }
}
initBounce();