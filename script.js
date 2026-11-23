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
