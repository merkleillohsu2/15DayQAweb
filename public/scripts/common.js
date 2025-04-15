// 固定的目標 URL 配置
const targetUrls = {
    sandbox: 'https://pmi--qa.sandbox.my.site.com/',
    production: 'https://tw.pmiandu.com/'
};

// 通用功能：向父窗口發送消息
function sendMessageToParent(messageType, messageData) {
    const environment = window.location.host.includes('15daytestweb') ? 'sandbox' : 'production'; // 根據域名判斷環境
    const targetUrl = targetUrls[environment];

    if (window.parent && targetUrl) {
        window.parent.postMessage({ type: messageType, ...messageData }, targetUrl);
    } else {
        console.error('父窗口不存在或無效的目標 URL');
    }
}

// 高度通知功能
function sendHeightToParent() {
    const height = document.documentElement.scrollHeight; // 取得整頁高度
    sendMessageToParent('iframeHeight', { iframeHeight: height }); // 使用通用方法發送高度
}

// 當內容加載完成後，通知父頁面
window.addEventListener('load', sendHeightToParent);

// 如果子頁面內容發生改變（例如，新增動態內容）
new ResizeObserver(() => sendHeightToParent()).observe(document.body);

// 示例：手動向父窗口發送其他消息
function navigateToParent(customMessage) {
    sendMessageToParent('customAction', customMessage); // 使用通用方法發送自定義消息
}

// 更新按鈕狀態的邏輯
function updateButtonState(button, buttonImg, checkbox, taskCompletedSrc) {
    const isCheckboxChecked = checkbox.checked;
    const isCompleted = buttonImg.getAttribute('src') === taskCompletedSrc;

    button.disabled = isCompleted || !isCheckboxChecked;
    button.style.opacity = button.disabled ? 0.5 : 1;
}

// 初始化 sessionStorage 通用功能
function initializeSessionStorage(contactId, queryParamName = 'query') {
    const query = new URLSearchParams(window.location.search).get(queryParamName);
    if (query && !sessionStorage.getItem('ContactId')) {
        sessionStorage.setItem('ContactId', contactId);
        sessionStorage.setItem('Query', query);
        console.log('ContactId 和 Query 已存儲到 sessionStorage');
    } else {
        console.log('ContactId 已經存在於 sessionStorage');
    }
}
//   彈窗邏輯
function setupPopupEvents(popup, readMoreImg, closePopupButton) {
    if (readMoreImg) {
        readMoreImg.addEventListener('click', () => popup.classList.remove('hidden'));
    }
    if (closePopupButton) {
        closePopupButton.addEventListener('click', () => popup.classList.add('hidden'));
    }
    if (popup) {
        popup.addEventListener('click', (event) => {
            if (event.target === popup) {
                popup.classList.add('hidden');
            }
        });
    }
}

// 通用的 API 提交邏輯
async function submitTask(apiEndpoint, userId, button, buttonImg, freezeLayer, taskCompletedSrc, rewardMessage) {
    button.disabled = true;
    buttonImg.setAttribute('src', taskCompletedSrc);
    freezeLayer.classList.add('active');

    try {
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ UserId: userId }),
        });

        if (!response.ok) {
            throw new Error(`HTTP 錯誤！狀態碼: ${response.status}`);
        }

        rewardMessage.classList.remove('hidden');
        console.log('任務完成！');
    } catch (error) {
        console.error('提交失敗:', error);
    } finally {
        freezeLayer.classList.remove('active');
    }
}

// Export function if using ES Modules (optional for future use)
// export { navigateToParent };