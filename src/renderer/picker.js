// Picker window logic: drag a rectangle with the mouse over the primary display,
// then submit the region back to main (which stores it as the OCR box).

const selection = document.getElementById('selection');
const sizeLabel = document.getElementById('sizeLabel');
let startX = 0;
let startY = 0;
let drawing = false;

function updateSelection(rect) {
  selection.style.display = rect.width > 2 && rect.height > 2 ? 'block' : 'none';
  selection.style.left = rect.x + 'px';
  selection.style.top = rect.y + 'px';
  selection.style.width = Math.max(0, rect.width) + 'px';
  selection.style.height = Math.max(0, rect.height) + 'px';
  sizeLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  drawing = true;
  startX = e.clientX;
  startY = e.clientY;
  updateSelection({ x: startX, y: startY, width: 0, height: 0 });
});

document.addEventListener('mousemove', (e) => {
  if (!drawing) return;
  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const width = Math.abs(e.clientX - startX);
  const height = Math.abs(e.clientY - startY);
  updateSelection({ x, y, width, height });
});

document.addEventListener('mouseup', async (e) => {
  if (!drawing) return;
  drawing = false;
  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const width = Math.abs(e.clientX - startX);
  const height = Math.abs(e.clientY - startY);
  if (width >= 20 && height >= 20) {
    await window.ocrTm.box.submitPick({ x, y, width, height });
  } else {
    sizeLabel.textContent = '区域太小，请重新框选';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.ocrTm.box.cancelPick();
  }
});

document.getElementById('btnCancel').addEventListener('click', () => {
  window.ocrTm.box.cancelPick();
});
