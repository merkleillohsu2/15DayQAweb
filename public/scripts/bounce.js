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
  const bounceURL = '/lottery/bounce' + window.location.search;

  function openBounce() {
    if (typeof navigateToParent === 'function') {
      navigateToParent(drawEvent);
    }
    bounceIframe.setAttribute('src', bounceURL);
    bouncePopup.classList.remove('hidden');
  }

  function closeBounce() {
    bouncePopup.classList.add('hidden');
    bounceIframe.setAttribute('src', '');
  }

  if (lotteryImage) {
    lotteryImage.addEventListener('click', openBounce);
  }

  if (rewardImg) {
    rewardImg.addEventListener('click', openBounce);
  }

  if (closeBouncePopup) {
    closeBouncePopup.addEventListener('click', closeBounce);
  }
}
initBounce();