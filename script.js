const frame = document.querySelector('#live-demo');
const tip = document.querySelector('#try-tip');
const buttons = [...document.querySelectorAll('.flows button')];
const tips = [
  '试试点击右栏的「定位原文」，再切到「逐题讲解」核对题目依据。',
  '试试把一个重点词存入「我的词汇」，随后到单词本查看。',
  '试试进入「查看练习」，勾选词条，选择题型并生成模拟题目。',
  '试试选择任一示例记录，再从历史结果返回文章解析。'
];
let active = buttons[0];

function showCurrentView() {
  frame.contentWindow.postMessage({
    type: 'judian:show',
    view: active.dataset.view,
    tab: active.dataset.tab
  }, location.protocol === 'file:' ? '*' : location.origin);
}

frame.addEventListener('load', showCurrentView);
for (const [index, button] of buttons.entries()) {
  button.addEventListener('click', () => {
    active = button;
    for (const item of buttons) {
      item.classList.toggle('active', item === active);
      item.setAttribute('aria-pressed', item === active);
    }
    tip.textContent = tips[index];
    showCurrentView();
  });
}

const dialog = document.querySelector('#image-dialog');
const expanded = dialog.querySelector('img');
for (const link of document.querySelectorAll('[data-image]')) {
  link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    expanded.src = link.href;
    expanded.alt = link.querySelector('img').alt;
    dialog.showModal();
  });
}
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});

const fitButton = document.querySelector('#fit-demo');
const frameScroll = frame.closest('.frame-scroll');
const narrowScreen = matchMedia('(max-width: 1008px)');
let fitRequested = false;

function updateDemoScale() {
  const fitted = fitRequested && narrowScreen.matches;
  frameScroll.classList.toggle('is-fitted', fitted);
  fitButton.setAttribute('aria-pressed', String(fitted));
  fitButton.textContent = fitted ? '恢复横向拖动' : '缩小显示';
  if (fitted) {
    const scale = Math.min(1, frameScroll.clientWidth / 960);
    frameScroll.style.setProperty('--demo-scale', scale);
    frameScroll.style.setProperty('--fitted-height', `${Math.ceil(frame.offsetHeight * scale)}px`);
    frameScroll.scrollLeft = 0;
  }
}

fitButton.addEventListener('click', () => {
  fitRequested = !fitRequested;
  updateDemoScale();
});
new ResizeObserver(updateDemoScale).observe(frameScroll);
narrowScreen.addEventListener('change', updateDemoScale);
