// HTML + client-side state machine for the Claude Island.
// Renders a vertical stack of pill rows — one per Claude Code session.
// CSS + JS are bundled into a single function export for the companion.

export function buildIslandHTML() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
:root { --scale: 1; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 100%; height: 100%;
  background: transparent !important;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  user-select: none; -webkit-user-select: none;
}

#stack {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; flex-direction: column; align-items: center;
  gap: 0; padding: 0;
}

.row {
  background: #F2C4CD;
  color: #4A1428;
  border-radius: 0;
  width: calc(460px * var(--scale));
  height: calc(34px * var(--scale));
  padding: 0 calc(14px * var(--scale));
  position: relative;
  display: flex; justify-content: space-between; align-items: center;
  gap: calc(10px * var(--scale));
  font-size: calc(11.5px * var(--scale)); font-weight: 500;
  white-space: nowrap; overflow: hidden;
  opacity: 0; max-height: 0;
  transition: opacity 240ms cubic-bezier(0.32, 0.72, 0, 1),
              max-height 320ms cubic-bezier(0.32, 0.72, 0, 1);
}
.row.visible { opacity: 1; max-height: calc(34px * var(--scale)); }
.row.visible + .row.visible { border-top: 1px solid rgba(75,20,40,0.12); }
.row.visible:last-of-type {
  border-radius: 0 0 calc(22px * var(--scale)) calc(22px * var(--scale));
}

body.notch-mode .row:first-child .slot.mid { visibility: hidden; }
body.notch-mode .row:first-child .t-sub { display: none; }

.slot { display: flex; align-items: center; gap: calc(7px * var(--scale)); min-width: 0; }
.slot.left  { flex: 0 1 auto; max-width: calc(130px * var(--scale)); min-width: 0; overflow: hidden; }
.slot.right { flex: 0 0 auto; }
.slot.mid {
  position: absolute; left: 50%; top: 0; bottom: 0;
  transform: translateX(-50%);
  justify-content: center; overflow: hidden;
  max-width: calc(150px * var(--scale));
  pointer-events: none;
}

.braille {
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  font-size: calc(13px * var(--scale)); line-height: 1;
  width: calc(13px * var(--scale)); text-align: center;
  flex-shrink: 0; display: inline-block;
}

.project { color: #3A0E1E; font-weight: 600; letter-spacing: -0.1px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sep    { color: rgba(75,20,40,0.35); flex-shrink: 0; }
.status { color: #5A1830; flex-shrink: 0; }
.detail {
  color: rgba(75,20,40,0.68);
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  font-size: calc(10.5px * var(--scale));
  overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 100%;
}
.prompt {
  color: rgba(75,20,40,0.72); font-style: italic; font-weight: 400;
  overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 100%;
}
.prompt::before { content: '\\201C'; opacity: 0.5; margin-right: 1px; }
.prompt::after  { content: '\\201D'; opacity: 0.5; margin-left: 1px; }

.meta {
  padding-left: calc(8px * var(--scale));
  border-left: 1px solid rgba(75,20,40,0.15);
  color: rgba(75,20,40,0.55);
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  font-size: calc(10px * var(--scale));
  display: flex; gap: calc(6px * var(--scale)); align-items: center; flex-shrink: 0;
}
.meta .mono { font-variant-numeric: tabular-nums; }
.ctx-warn { color: #A06200; }
.ctx-hot  { color: #B02828; }
@keyframes pulse-waiting {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.15; transform: scale(1.35); }
}
@keyframes glow-waiting {
  0%, 100% {
    box-shadow: 0 0 12px rgba(175, 65, 100, 0.5), 0 0 30px rgba(175, 65, 100, 0.2);
    background: #F2C4CD;
  }
  50% {
    box-shadow: 0 0 28px rgba(175, 65, 100, 0.85), 0 0 60px rgba(175, 65, 100, 0.38);
    background: #E8AABA;
  }
}
.row[data-status="waiting"] {
  animation: glow-waiting 0.9s ease-in-out infinite;
}
.row[data-status="waiting"] .braille {
  animation: pulse-waiting 0.9s ease-in-out infinite;
}
@keyframes glow-done {
  0%, 100% {
    box-shadow: 0 0 10px rgba(38, 155, 85, 0.45), 0 0 26px rgba(38, 155, 85, 0.18);
    background: #F2C4CD;
  }
  50% {
    box-shadow: 0 0 24px rgba(38, 155, 85, 0.8), 0 0 52px rgba(38, 155, 85, 0.32);
    background: #D5E8DD;
  }
}
.row[data-status="done"] {
  animation: glow-done 1.5s ease-in-out infinite;
}
.row[data-status="done"] .braille {
  animation: pulse-waiting 1.5s ease-in-out infinite;
}

#stack { opacity: 1; transition: opacity 280ms ease; }
body.island-hover #stack { opacity: 0.06; transition: opacity 200ms ease; }
</style>
</head>
<body>
<div id="stack"></div>
<script>
(function () {
  var stack = document.getElementById('stack');
  var STATUS = {
    thinking:  { color: '#B84068', label: 'Working',    spin: true  },
    reading:   { color: '#4060B8', label: 'Reading',    spin: true  },
    editing:   { color: '#A87800', label: 'Editing',    spin: true  },
    writing:   { color: '#A87800', label: 'Writing',    spin: true  },
    running:   { color: '#B84040', label: 'Running',    spin: true  },
    searching: { color: '#7048B0', label: 'Searching',  spin: true  },
    done:      { color: '#289858', label: 'Done',       spin: false },
    error:     { color: '#C03040', label: 'Error',      spin: false },
    waiting:   { color: '#B84068', label: '等待确认',   spin: true  },
  };
  var BRAILLE = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  var brailleIdx = 0;
  var rows = {}; var order = [];
  var tickerB = null, tickerT = null;

  var SCALES = { small: 0.88, medium: 1.0, large: 1.18, xlarge: 1.35 };

  function esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function fmtElapsedParts(ms) {
    var s = Math.floor(ms/1000);
    if (s < 60) return { main: s+'s', sub: '' };
    var m = Math.floor(s/60); s = s%60;
    if (m < 60) return { main: m+'m', sub: ' '+(s<10?'0':'')+s+'s' };
    var h = Math.floor(m/60); m = m%60;
    return { main: h+'h', sub: ' '+(m<10?'0':'')+m+'m' };
  }

  function fmtElapsedHTML(ms) {
    var f = fmtElapsedParts(ms);
    return '<span class="t-main">'+f.main+'</span><span class="t-sub">'+f.sub+'</span>';
  }

  function anySpinning() {
    for (var id in rows) { var r=rows[id]; if (r&&!r.removing){ var s=STATUS[r.data.status]; if(s&&s.spin) return true; } }
    return false;
  }
  function anyRunning() { for (var id in rows) if (rows[id]&&!rows[id].removing) return true; return false; }

  function startTickers() {
    if (!tickerB && anySpinning()) {
      tickerB = setInterval(function () {
        brailleIdx = (brailleIdx+1)%BRAILLE.length;
        var nodes = document.querySelectorAll('.braille');
        for (var i=0;i<nodes.length;i++) {
          var rowEl = nodes[i].closest('.row');
          if (rowEl && rowEl.dataset.spin==='true') nodes[i].textContent = BRAILLE[brailleIdx];
        }
        if (!anySpinning()) { clearInterval(tickerB); tickerB=null; }
      }, 80);
    }
    if (!tickerT && anyRunning()) {
      tickerT = setInterval(function () {
        for (var id in rows) {
          var r=rows[id]; if (!r||r.removing) continue;
          if (r.data.frozenElapsed!=null) continue;
          var el=r.el.querySelector('.t-elapsed');
          if (el&&r.data.startedAt) el.innerHTML = fmtElapsedHTML(Date.now()-r.data.startedAt);
        }
        if (!anyRunning()) { clearInterval(tickerT); tickerT=null; }
      }, 250);
    }
  }

  function renderRowContent(row) {
    var d=row.data, s=STATUS[d.status]||STATUS.thinking;
    var task = d.detail||d.prompt||'';
    var taskCls = d.detail?'detail':'prompt';
    var left = '<span class="braille" style="color:'+s.color+'">'+BRAILLE[brailleIdx]+'</span>';
    if (d.project) left += '<span class="project">'+esc(d.project)+'</span>';
    var mid = task?'<span class="'+taskCls+'">'+esc(task)+'</span>':'';
    var right = '';
    if (s.label) right += '<span class="status">'+esc(s.label)+'</span>';
    var hasMeta = d.startedAt||d.ctxPct!=null;
    if (hasMeta) {
      right += '<div class="meta">';
      if (d.startedAt) { var t=d.frozenElapsed!=null?d.frozenElapsed:(Date.now()-d.startedAt); right+='<span class="mono t-elapsed">'+fmtElapsedHTML(t)+'</span>'; }
      if (d.ctxPct!=null) { if(d.startedAt)right+='<span class="sep">·</span>'; var cls=d.ctxPct>=85?'ctx-hot':d.ctxPct>=60?'ctx-warn':''; right+='<span class="mono '+cls+'">'+Math.round(d.ctxPct)+'%</span>'; }
      right += '</div>';
    }
    row.el.dataset.spin = s.spin?'true':'false';
    row.el.dataset.status = d.status;
    row.el.innerHTML = '<div class="slot left">'+left+'</div><div class="slot mid">'+mid+'</div><div class="slot right">'+right+'</div>';
  }

  function upsertRow(id, data) {
    var existing = rows[id];
    if (existing && !existing.removing) {
      existing.data = Object.assign({}, existing.data, data);
      renderRowContent(existing); startTickers(); return;
    }
    var el = document.createElement('div'); el.className = 'row'; el.setAttribute('data-id', id);
    var row = { id: id, data: Object.assign({}, data), el: el, removing: false };
    if (!row.data.startedAt) row.data.startedAt = Date.now();
    rows[id] = row; order.push(id); stack.appendChild(el);
    renderRowContent(row);
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('visible'); }); });
    startTickers();
  }

  function removeRow(id) {
    var row = rows[id]; if (!row||row.removing) return;
    row.removing = true; row.el.classList.remove('visible');
    setTimeout(function () { if (row.el.parentNode) row.el.parentNode.removeChild(row.el); delete rows[id]; var i=order.indexOf(id); if(i>=0)order.splice(i,1); }, 340);
  }

  function setMode(mode) { document.body.classList.toggle('notch-mode', mode === 'notch'); }
  function setScale(scale) { var factor=SCALES[scale]; if(factor==null)factor=SCALES.medium; document.documentElement.style.setProperty('--scale',String(factor)); }

  window.island = { upsertRow:upsertRow, removeRow:removeRow, setMode:setMode, setScale:setScale };
})();
</script>
</body>
</html>`;
}
