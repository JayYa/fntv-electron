/* exported ipcRenderer, loginBtn, domainInput, domainError, usernameInput, passwordInput, passwordToggle,
    passwordToggleImg, accessCodeInput, accessCodeToggle, accessCodeToggleImg, historyBtn,
    historyDropdown, customConfirm, confirmMessage, confirmCancel, confirmOk, customMessage,
    messageIcon, messageTitle, messageContent, messageButton, versionText, updateBtn,
    proxySettingsBtn, proxyPanel, proxyCloseBtn, proxyEnabledSwitch, proxyUrlInput, proxySaveBtn,
    mpvPlaybackSwitch */

const ipcRenderer = window.electronAPI;

const loginBtn = document.getElementById('loginBtn');
const domainInput = document.getElementById('domain');
const domainError = document.getElementById('domainError');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const passwordToggle = document.getElementById('passwordToggle');
const passwordToggleImg = document.getElementById('passwordToggleImg');
const accessCodeInput = document.getElementById('accessCode');
const accessCodeToggle = document.getElementById('accessCodeToggle');
const accessCodeToggleImg = document.getElementById('accessCodeToggleImg');
const historyBtn = document.getElementById('historyBtn');
const historyDropdown = document.getElementById('historyDropdown');
const customConfirm = document.getElementById('customConfirm');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancel = document.getElementById('confirmCancel');
const confirmOk = document.getElementById('confirmOk');
const customMessage = document.getElementById('customMessage');
const messageIcon = document.getElementById('messageIcon');
const messageTitle = document.getElementById('messageTitle');
const messageContent = document.getElementById('messageContent');
const messageButton = document.getElementById('messageButton');
const versionText = document.getElementById('versionText');
const updateBtn = document.getElementById('updateBtn');
const proxySettingsBtn = document.getElementById('proxySettingsBtn');
const proxyPanel = document.getElementById('proxyPanel');
const proxyCloseBtn = document.getElementById('proxyCloseBtn');
const proxyEnabledSwitch = document.getElementById('proxyEnabledSwitch');
const proxyUrlInput = document.getElementById('proxyUrlInput');
const proxySaveBtn = document.getElementById('proxySaveBtn');
const mpvPlaybackSwitch = document.getElementById('mpvPlaybackSwitch');
