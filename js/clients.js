/* ============================================================
   TASKS SEVEN — clientes

   Um cliente é uma entidade própria (não uma tag), porque o
   status dele muda com o tempo e a tarefa não deveria carregar
   essa informação duplicada. A tarefa guarda só o id.

   Os status são fixos: são um funil de saúde de conta, não
   colunas arbitrárias como as do quadro de tarefas.
   ============================================================ */
(function (global) {
  'use strict';

  var STATUS = [
    { id: 'geral',   label: 'Geral',           color: '#a78bfa', hint: 'ainda sem leitura' },
    { id: 'feliz',   label: 'Cliente feliz',   color: '#4ade80', hint: 'entrega reconhecida' },
    { id: 'neutro',  label: 'Cliente neutro',  color: '#fbbf24', hint: 'sem atrito, sem entusiasmo' },
    { id: 'critico', label: 'Cliente crítico', color: '#fb7185', hint: 'risco à vista' },
    { id: 'churn',   label: 'Churn',           color: '#6b7280', hint: 'saiu da base' }
  ];

  function status(id) {
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].id === id) return STATUS[i];
    return STATUS[0];
  }

  function byId(state, id) {
    if (!id || !state.clients) return null;
    for (var i = 0; i < state.clients.length; i++) if (state.clients[i].id === id) return state.clients[i];
    return null;
  }

  function byName(state, name) {
    var alvo = String(name || '').trim().toLowerCase();
    if (!alvo) return null;
    for (var i = 0; i < state.clients.length; i++) {
      if (state.clients[i].name.trim().toLowerCase() === alvo) return state.clients[i];
    }
    return null;
  }

  /* Cria na hora se não existir — é o que faz "adicionar cliente" ser
     só digitar o nome no campo da tarefa. */
  function ensure(state, name) {
    var nome = String(name || '').trim();
    if (!nome) return null;
    var achado = byName(state, nome);
    if (achado) return achado;
    var novo = {
      id: Store.uid(), name: nome.slice(0, 40), status: 'geral',
      notes: '', createdAt: Date.now()
    };
    state.clients.push(novo);
    return novo;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- quadro de clientes ---------------- */

  function render(boardEl, state, ctx) {
    boardEl.innerHTML = '';
    boardEl.classList.add('board-clients');

    STATUS.forEach(function (st) {
      var lista = state.clients.filter(function (c) { return (c.status || 'geral') === st.id; });

      var sec = document.createElement('section');
      sec.className = 'column col-' + st.id;
      sec.dataset.status = st.id;
      sec.style.setProperty('--acc', st.color);

      sec.innerHTML =
        '<div class="col-accent"></div>' +
        '<div class="col-head">' +
          '<span class="col-dot"></span>' +
          '<span class="col-title fixed">' + st.label + '</span>' +
          '<span class="count">' + lista.length + '</span>' +
          '<button class="col-btn add" title="Novo cliente aqui" aria-label="Novo cliente">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="col-sub">' + st.hint + '</div>' +
        '<div class="col-body" data-status="' + st.id + '"></div>';

      var body = sec.querySelector('.col-body');

      lista.forEach(function (c) { body.appendChild(cardEl(c, state, ctx)); });

      if (!lista.length) {
        var vazio = document.createElement('div');
        vazio.className = 'col-empty';
        vazio.textContent = 'arraste um cliente pra cá';
        body.appendChild(vazio);
      }

      sec.querySelector('.col-btn.add').addEventListener('click', function () { ctx.novo(st.id); });

      body.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        sec.classList.add('drop-target');
        var arrastando = boardEl.querySelector('.ccard.dragging');
        if (!arrastando) return;
        var vaz = body.querySelector('.col-empty');
        if (vaz) vaz.remove();
        var depois = dragAfter(body, e.clientY);
        if (depois == null) body.appendChild(arrastando);
        else body.insertBefore(arrastando, depois);
      });
      body.addEventListener('dragleave', function (e) {
        if (!body.contains(e.relatedTarget)) sec.classList.remove('drop-target');
      });
      body.addEventListener('drop', function (e) { e.preventDefault(); });

      boardEl.appendChild(sec);
    });
  }

  function cardEl(c, state, ctx) {
    var st = status(c.status);
    var n = ctx.contagem(c.id);

    var el = document.createElement('article');
    el.className = 'ccard st-' + st.id;
    el.draggable = true;
    el.dataset.id = c.id;
    el.style.setProperty('--c', st.color);

    var meta = [];
    if (n.abertas) meta.push('<span class="cm">' + n.abertas + ' aberta(s)</span>');
    if (n.entregues) meta.push('<span class="cm">' + n.entregues + ' entregue(s) · 30d</span>');
    if (!meta.length) meta.push('<span class="cm off">sem tarefa vinculada</span>');

    el.innerHTML =
      '<div class="ccard-top"><span class="cdot"></span><b>' + esc(c.name) + '</b></div>' +
      (c.notes ? '<p class="card-notes">' + esc(c.notes) + '</p>' : '') +
      '<div class="ccard-meta">' + meta.join('') + '</div>';

    el.addEventListener('click', function () { ctx.abrir(c.id); });
    el.addEventListener('dragstart', function (e) {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', c.id); } catch (err) { /* noop */ }
    });
    el.addEventListener('dragend', function () {
      el.classList.remove('dragging');
      ctx.persistir();
    });

    return el;
  }

  function dragAfter(body, y) {
    var cards = Array.prototype.slice.call(body.querySelectorAll('.ccard:not(.dragging)'));
    var best = null, bestOffset = -Infinity;
    cards.forEach(function (c) {
      var box = c.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > bestOffset) { bestOffset = offset; best = c; }
    });
    return best;
  }

  global.Clients = {
    STATUS: STATUS,
    status: status,
    byId: byId,
    byName: byName,
    ensure: ensure,
    render: render
  };
})(window);
