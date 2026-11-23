const preview = document.querySelector('#preview');
const tabs = document.querySelectorAll('[data-preview]');
const descriptions = {
  analysis: '文章解析和原文定位',
  words: '单词本示例词表',
  practice: '词汇练习题型选择'
};

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const view = tab.dataset.preview;
    const image = preview.querySelector('img');
    preview.href = `assets/judian-${view}-0910.png`;
    image.src = preview.href;
    image.alt = descriptions[view];
    for (const item of tabs) {
      item.classList.toggle('active', item === tab);
      item.setAttribute('aria-pressed', String(item === tab));
    }
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
