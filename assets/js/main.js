/* ==========================================================================
   TINA NAILS : site statique autonome (aucun back-end, aucun abonnement)
   - Réservation = demande préremplie par SMS / appel / fichier .ics
   - Animations : GSAP + ScrollTrigger + Lenis (hébergés localement)
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const root = document.documentElement;
  root.classList.add('js');

  const PHONE = '+33603194170';
  const PHONE_HUMAN = '06 03 19 41 70';
  const TZ = 'Europe/Paris';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const canAnimate = !reduce && typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';

  let lenis = null;
  let menuOpen = false;
  const pins = {}; // id de section -> position de départ (sections épinglées)

  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ------------------------------------------------------------------ */
  /*  Réservation : formulaire -> SMS préremplie / .ics / copie           */
  /* ------------------------------------------------------------------ */
  function initBooking() {
    const form = $('#bookForm');
    if (!form) return;

    const elS = $('#bkServices'), elD = $('#bkDays'), elT = $('#bkTimes');
    const name = $('#bkName'), note = $('#bkNote'), prev = $('#bkPreview');
    const sms = $('#bkSms'), ics = $('#bkIcs'), copyBtn = $('#bkCopy'), status = $('#bkStatus');
    const DEFAULT_STATUS = status.textContent;
    const ADVICE = 'Je ne sais pas encore, besoin de conseils';
    const state = { service: null, date: null, time: null, shade: '' };

    const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const fmtWk = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
    const fmtMo = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

    elS.setAttribute('role', 'group');
    elD.setAttribute('role', 'group');
    elT.setAttribute('role', 'group');

    function makeBtn(cls, html, label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.setAttribute('aria-pressed', 'false');
      if (label) b.setAttribute('aria-label', label);
      b.innerHTML = html;
      return b;
    }
    function select(container, btn) {
      $$('[aria-pressed="true"]', container).forEach((x) => x.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
    }

    // 1. prestations (lues dans les cartes pour rester synchronisées)
    const services = $$('.card[data-service]').map((c) => c.dataset.service);
    services.push(ADVICE);
    services.forEach((s) => {
      const b = makeBtn('chip', s);
      b.addEventListener('click', () => { state.service = s; select(elS, b); update(); });
      elS.appendChild(b);
    });
    // bouton « Réserver » sur chaque carte : présélectionne la prestation
    function setService(s) {
      const b = $$('.chip', elS).find((x) => x.textContent === s);
      if (b) { state.service = s; select(elS, b); update(); }
    }
    $$('.card[data-service]').forEach((c) => {
      const a = document.createElement('a');
      a.href = '#reserver'; a.className = 'card__book link';
      a.innerHTML = 'Réserver <span aria-hidden="true">→</span>';
      a.setAttribute('aria-label', `Réserver : ${c.dataset.service}`);
      a.addEventListener('click', () => setService(c.dataset.service));
      $('.card__tilt', c).appendChild(a);
    });

    // 2. jours : du lundi au samedi, 12 prochains jours ouvrés
    const slotsFor = (d) => {
      const out = [];
      for (let h = 10; h <= 17; h++) for (const m of [0, 30]) {
        if (h === 17 && m === 30) continue;
        out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      return out.map((t) => {
        const [hh, mm] = t.split(':').map(Number);
        const dt = new Date(d); dt.setHours(hh, mm, 0, 0);
        return { t, disabled: isToday && dt.getTime() < now.getTime() + 60 * 60000 };
      });
    };
    const days = [];
    const cur = new Date(); cur.setHours(0, 0, 0, 0);
    while (days.length < 12) {
      if (cur.getDay() !== 0 && slotsFor(cur).some((s) => !s.disabled)) days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    days.forEach((d, i) => {
      const label = `${fmtLong.format(d)}`;
      const b = makeBtn('day', `<span>${fmtWk.format(d).replace('.', '')}</span><b>${d.getDate()}</b><small>${fmtMo.format(d).replace('.', '')}</small>`, label);
      b.addEventListener('click', () => {
        state.date = d; state.time = null; select(elD, b); renderTimes(d); update();
      });
      elD.appendChild(b);
      if (i === 0) b.dataset.first = '1';
    });

    // 3. heures
    function renderTimes(d) {
      elT.innerHTML = '';
      slotsFor(d).forEach(({ t, disabled }) => {
        const b = makeBtn('time', t.replace(':', 'h'));
        b.disabled = disabled;
        b.addEventListener('click', () => { state.time = t; select(elT, b); update(); });
        elT.appendChild(b);
      });
    }

    // 4. message
    const hourLabel = (t) => t.replace(':', 'h');
    function buildMessage() {
      const n = name.value.trim();
      const when = `le ${fmtLong.format(state.date)} à ${hourLabel(state.time)}`;
      const what = state.service === ADVICE
        ? `Je souhaiterais un rendez-vous ${when}. Je ne sais pas encore quelle prestation choisir, j'aimerais votre conseil.`
        : `Je souhaiterais réserver : ${state.service}, ${when}.`;
      const lines = [`Bonjour Tina, c'est ${n}.`, what];
      if (note.value.trim()) lines.push(note.value.trim());
      if (state.shade) lines.push(state.shade);
      lines.push('Pouvez-vous me confirmer le créneau ? Merci !');
      return lines.join('\n');
    }
    function missing() {
      const m = [];
      if (!state.service) m.push('la prestation');
      if (!state.date) m.push('le jour');
      else if (!state.time) m.push("l'heure");
      if (!name.value.trim()) m.push('votre prénom');
      return m;
    }
    let message = '';
    function update() {
      const m = missing();
      const ready = m.length === 0;
      status.textContent = DEFAULT_STATUS;
      if (ready) {
        message = buildMessage();
        prev.textContent = message;
        sms.href = `sms:${PHONE}?&body=${encodeURIComponent(message)}`;
      } else {
        message = '';
        prev.textContent = `Il manque encore : ${m.join(', ')}.`;
        sms.href = '#reserver';
      }
      sms.classList.toggle('is-disabled', !ready);
      sms.setAttribute('aria-disabled', String(!ready));
      ics.disabled = !ready;
      copyBtn.disabled = !ready;
    }
    name.addEventListener('input', update);
    note.addEventListener('input', update);
    form.addEventListener('submit', (e) => e.preventDefault());
    update();
    prev.textContent = 'Complétez les étapes ci-dessus : votre message apparaît ici.';

    sms.addEventListener('click', (e) => {
      if (sms.classList.contains('is-disabled')) { e.preventDefault(); return; }
      status.textContent = `Si vos SMS ne se sont pas ouverts, copiez le message et envoyez-le au ${PHONE_HUMAN}.`;
    });

    copyBtn.addEventListener('click', async () => {
      if (!message) return;
      try {
        await navigator.clipboard.writeText(message);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = message; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      status.textContent = `Message copié. Envoyez-le par SMS ou WhatsApp au ${PHONE_HUMAN}.`;
    });

    ics.addEventListener('click', () => {
      if (!message) return;
      const p = (n) => String(n).padStart(2, '0');
      const [h, m] = state.time.split(':').map(Number);
      const s = new Date(state.date); s.setHours(h, m, 0, 0);
      const e = new Date(s.getTime() + 60 * 60000);
      const f = (d) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
      const now = new Date();
      const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}00Z`;
      const esc = (t) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
      const svcLabel = state.service === ADVICE ? 'Rendez-vous' : state.service;
      const body = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TINA NAILS//Reservation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${Date.now()}@tina-nails.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${f(s)}`,
        `DTEND:${f(e)}`,
        `SUMMARY:${esc(`TINA NAILS : ${svcLabel} (à confirmer)`)}`,
        `LOCATION:${esc('TINA NAILS, 19 rue Aumône Vieille, 13100 Aix-en-Provence')}`,
        `DESCRIPTION:${esc(`Demande de rendez-vous à confirmer par Tina. Tél. ${PHONE_HUMAN}. Durée indicative.`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Rendez-vous TINA NAILS', 'TRIGGER:-PT3H', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n');
      const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'rdv-tina-nails.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      status.textContent = "Fichier agenda téléchargé. N'oubliez pas d'envoyer la demande à Tina.";
    });

    // API pour le nuancier : la teinte choisie s'ajoute au message sans écraser la note
    return { setShade: (t) => { state.shade = t; update(); } };
  }

  /* ------------------------------------------------------------------ */
  /*  Tarifs : renseigner data-price="35 €" sur une carte pour l'afficher */
  /* ------------------------------------------------------------------ */
  function initPrices() {
    $$('.card[data-price]').forEach((c) => {
      const p = c.dataset.price.trim();
      const pill = $('.card__price', c);
      if (p && pill) pill.textContent = p;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Horaires / ouvert maintenant (heure de Paris)                       */
  /* ------------------------------------------------------------------ */
  function initHours() {
    const box = $('#openStatus');
    if (!box) return;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = map[get('weekday')];
    const now = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
    $$('#hours tr').forEach((r) => r.classList.toggle('is-today', Number(r.dataset.day) === day));
    const open = day !== 0 && now >= 600 && now < 1080;
    let txt;
    if (open) txt = 1080 - now <= 45 ? 'Ouvert · ferme bientôt (18h)' : "Ouvert maintenant · jusqu'à 18h";
    else if (day === 0 || (day === 6 && now >= 1080)) txt = 'Fermé · réouverture lundi à 10h';
    else if (now < 600) txt = "Fermé · ouverture aujourd'hui à 10h";
    else txt = 'Fermé · réouverture demain à 10h';
    box.classList.toggle('is-open', open);
    $('span', box).textContent = txt;
  }

  /* ------------------------------------------------------------------ */
  /*  Avis : boutons précédent / suivant (défilement natif)               */
  /* ------------------------------------------------------------------ */
  function initReviews() {
    const track = $('#revTrack');
    if (!track) return;
    const step = () => { const q = $('.quote', track); return q ? q.getBoundingClientRect().width + 24 : 340; };
    $('#revPrev').addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduce ? 'auto' : 'smooth' }));
    $('#revNext').addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduce ? 'auto' : 'smooth' }));
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); track.scrollBy({ left: step(), behavior: 'smooth' }); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); track.scrollBy({ left: -step(), behavior: 'smooth' }); }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Nuancier : 5 ongles qui se repeignent                               */
  /* ------------------------------------------------------------------ */
  const SHADES = [
    { n: 'Rose Dragée', c: '#FF7EB6' },
    { n: 'Fuchsia Pop', c: '#F0207F' },
    { n: 'Bleu Nuit Galaxie', c: '#1E3CA8' },
    { n: 'Vert Œil-de-chat', c: '#13975A' },
    { n: 'Bordeaux Étoilé', c: '#7A1030' },
    { n: 'Citron Givré', c: '#F4E06A' },
    { n: 'Lilas Prisme', c: '#A58BFF' },
    { n: 'Nude Cristal', c: '#E9BFA8' }
  ];
  function initNuancier(booking) {
    const stage = $('#nuanStage'), list = $('#swatches'), nameEl = $('#nuanName'), sec = $('#nuancier');
    if (!stage) return;
    const nails = $$('.nail', stage);
    let current = 0;
    nails.forEach((n) => { $('.nail__paint', n).style.setProperty('--c', SHADES[0].c); });

    SHADES.forEach((s, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch'; b.style.setProperty('--c', s.c);
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(i === 0)); b.setAttribute('aria-label', s.n);
      b.title = s.n;
      b.addEventListener('click', () => paint(i));
      li.appendChild(b); list.appendChild(li);
    });

    function paint(i) {
      if (i === current && !canAnimate) return;
      current = i;
      const s = SHADES[i];
      $$('.swatch', list).forEach((b, k) => b.setAttribute('aria-checked', String(k === i)));
      sec.style.setProperty('--polish', s.c);
      if (booking) booking.setShade(`Teinte d'inspiration : ${s.n}.`);
      if (!canAnimate) {
        nails.forEach((n) => $('.nail__paint', n).style.setProperty('--c', s.c));
        nameEl.textContent = s.n;
        return;
      }
      nails.forEach((n, k) => {
        const sweep = $('.nail__sweep', n), base = $('.nail__paint', n);
        sweep.style.setProperty('--c', s.c);
        gsap.killTweensOf(sweep);
        gsap.fromTo(sweep, { scaleY: 0 }, {
          scaleY: 1, duration: .85, ease: 'power3.inOut', delay: k * .09,
          onComplete: () => { base.style.setProperty('--c', s.c); gsap.set(sweep, { scaleY: 0 }); }
        });
      });
      gsap.timeline()
        .to(nameEl, { yPercent: -30, opacity: 0, duration: .25, ease: 'power2.in' })
        .add(() => { nameEl.textContent = s.n; })
        .fromTo(nameEl, { yPercent: 30, opacity: 0 }, { yPercent: 0, opacity: 1, duration: .6, ease: 'expo.out' });
    }
    nameEl.textContent = SHADES[0].n; // la teinte n'entre dans le message qu'après un vrai choix

    // reflet œil-de-chat qui suit le pointeur
    if (fine && canAnimate) {
      const sheens = nails.map((n) => $('.nail__sheen', n));
      stage.addEventListener('pointermove', (e) => {
        const r = stage.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width; // 0..1
        sheens.forEach((s, k) => gsap.to(s, { xPercent: -95 + px * 190 + (k - 2) * 6, duration: .6, ease: 'power3.out', overwrite: 'auto' }));
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Menu mobile                                                         */
  /* ------------------------------------------------------------------ */
  function setMenu(open) {
    const burger = $('#burger'), menu = $('#menu'), nav = $('#nav');
    menuOpen = open;
    menu.classList.toggle('is-open', open);
    burger.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    menu.setAttribute('aria-hidden', String(!open));
    nav.classList.remove('is-hidden');
    if (lenis) { open ? lenis.stop() : lenis.start(); }
    else document.body.style.overflow = open ? 'hidden' : '';
  }
  function initMenu() {
    $$('#menu nav a').forEach((a, i) => a.style.setProperty('--i', i));
    $('#burger').addEventListener('click', () => setMenu(!menuOpen));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) setMenu(false); });
  }

  /* ------------------------------------------------------------------ */
  /*  Ancres (compatibles smooth scroll + sections épinglées)             */
  /* ------------------------------------------------------------------ */
  function initAnchors() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = $(id);
      if (!target) return;
      if (a.classList.contains('is-disabled')) return;
      e.preventDefault();
      if (menuOpen) setMenu(false);
      const y = pins[id.slice(1)];
      if (lenis) {
        if (typeof y === 'number') lenis.scrollTo(y, { duration: 1.6 });
        else lenis.scrollTo(target, { duration: 1.6, offset: id === '#top' ? 0 : -8 });
      } else {
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }
      history.replaceState(null, '', id);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Split texte (mots / lettres) avec masque                            */
  /* ------------------------------------------------------------------ */
  function splitWords(el) {
    const inners = [];
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    const walk = (node) => {
      Array.from(node.childNodes).forEach((ch) => {
        if (ch.nodeType === 3) {
          const frag = document.createDocumentFragment();
          ch.textContent.split(/([ \t\r\n]+)/).forEach((tok, idx) => {
            if (!tok) return;
            if (/^[ \t\r\n]+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
            // ponctuation collée au mot précédent : on ne la détache pas (évite un point orphelin à la ligne)
            if (idx === 0 && /^[.,;:!?…»)]+$/.test(tok)) { frag.appendChild(document.createTextNode(tok)); return; }
            const w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
            const i = document.createElement('span'); i.className = 'wi'; i.textContent = tok;
            w.appendChild(i); frag.appendChild(w); inners.push(i);
          });
          ch.replaceWith(frag);
        } else if (ch.nodeType === 1) walk(ch);
      });
    };
    walk(el);
    return inners;
  }
  function splitChars(el) {
    const text = el.textContent;
    el.dataset.text = text;
    el.setAttribute('aria-hidden', 'false');
    const inners = [];
    el.textContent = '';
    text.split(' ').forEach((word, wi) => {
      if (wi) el.appendChild(document.createTextNode(' '));
      const wc = document.createElement('span'); wc.className = 'wc'; wc.setAttribute('aria-hidden', 'true');
      Array.from(word).forEach((ch) => {
        const c = document.createElement('span'); c.className = 'c';
        const i = document.createElement('span'); i.className = 'ci'; i.textContent = ch;
        c.appendChild(i); wc.appendChild(c); inners.push(i);
      });
      el.appendChild(wc);
    });
    return inners;
  }

  /* ------------------------------------------------------------------ */
  /*  Étincelles du hero                                                  */
  /* ------------------------------------------------------------------ */
  function initSparks() {
    const box = $('#sparks');
    if (!box) return;
    const n = matchMedia('(max-width: 899px)').matches ? 14 : 34;
    const cols = ['#FFF3EA', '#F8E27C', '#6FF2C0', '#B197FF', '#FF7EB6'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'sp';
      s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;--s:${6 + Math.random() * 16}px;--c:${cols[i % cols.length]};--d:${2.4 + Math.random() * 3}s;--dl:${Math.random() * 4}s`;
      box.appendChild(s);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Vidéo d'intro                                                       */
  /* ------------------------------------------------------------------ */
  function initVideo() {
    const v = $('#heroVideo');
    if (!v) return;
    const saver = navigator.connection && navigator.connection.saveData;
    if (reduce || saver) return; // image de secours seulement
    const desktop = matchMedia('(min-width: 900px)').matches;
    v.src = desktop ? 'assets/video/hero-720.mp4' : 'assets/video/hero-sd.mp4';
    v.muted = true;
    const play = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    play();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((en) => en.forEach((x) => (x.isIntersecting ? play() : v.pause())), { threshold: 0.05 }).observe(v);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Mouvement (GSAP / ScrollTrigger / Lenis)                            */
  /* ------------------------------------------------------------------ */
  function initMotion() {
    gsap.registerPlugin(ScrollTrigger);
    const nav = $('#nav');

    /* --- smooth scroll --- */
    lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();

    /* --- barre de progression + nav + bouton flottant --- */
    const progress = $('#progress'), fab = $('.fab');
    lenis.on('scroll', ({ scroll, limit, direction }) => {
      progress.style.transform = `scaleX(${limit > 0 ? scroll / limit : 0})`;
      nav.classList.toggle('is-scrolled', scroll > 40);
      if (!menuOpen) nav.classList.toggle('is-hidden', direction === 1 && scroll > 260);
      fab.classList.toggle('is-visible', scroll > window.innerHeight * 0.6);
    });

    /* --- marquee réactif au scroll --- */
    (() => {
      const track = $('#marqueeTrack');
      if (!track) return;
      let w = track.firstElementChild.offsetWidth, x = 0, dir = -1, boost = 0;
      addEventListener('resize', () => { w = track.firstElementChild.offsetWidth; });
      lenis.on('scroll', ({ velocity }) => {
        if (Math.abs(velocity) > 0.05) dir = velocity > 0 ? -1 : 1;
        boost = Math.min(Math.abs(velocity), 40);
      });
      gsap.ticker.add(() => {
        boost *= 0.93;
        x += dir * (1.1 + boost * 0.55);
        if (x <= -w) x += w;
        if (x > 0) x -= w;
        gsap.set(track, { x });
      });
    })();

    /* --- titres : mots qui montent --- */
    $$('[data-words]').forEach((h) => {
      const words = splitWords(h);
      gsap.set(words, { yPercent: 115 });
      ScrollTrigger.create({
        trigger: h, start: 'top 88%', once: true,
        onEnter: () => gsap.to(words, { yPercent: 0, duration: 1.15, ease: 'expo.out', stagger: 0.055 })
      });
    });

    /* --- compteurs --- */
    $$('[data-count]').forEach((el) => {
      const end = parseFloat(el.dataset.count), dec = parseInt(el.dataset.dec || '0', 10);
      const o = { v: 0 };
      el.textContent = (0).toFixed(dec).replace('.', ',');
      ScrollTrigger.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: () => gsap.to(o, { v: end, duration: 2.2, ease: 'power2.out', onUpdate: () => { el.textContent = o.v.toFixed(dec).replace('.', ','); } })
      });
    });
    gsap.from('.stat', { y: 70, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: '.stats__grid', start: 'top 85%', once: true } });

    /* --- parallax hero multicouche --- */
    const heroST = { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true };
    gsap.to('.hero__media', { yPercent: 16, ease: 'none', scrollTrigger: heroST });
    gsap.to('.hero__sparks', { yPercent: -22, ease: 'none', scrollTrigger: heroST });
    gsap.to('.hero__content', { yPercent: -14, ease: 'none', scrollTrigger: heroST });
    $$('.float').forEach((f) => gsap.to(f, { yPercent: -45 * parseFloat(f.dataset.depth || 1), ease: 'none', scrollTrigger: heroST }));
    gsap.to('.hero__badge', { yPercent: -60, rotate: 60, ease: 'none', scrollTrigger: heroST });
    if (fine) {
      const hero = $('.hero');
      const movers = $$('.float .almond').map((el, i) => ({ x: gsap.quickTo(el, 'x', { duration: 1.1, ease: 'power3.out' }), y: gsap.quickTo(el, 'y', { duration: 1.1, ease: 'power3.out' }), k: [26, -40, 18][i] || 20 }));
      hero.addEventListener('pointermove', (e) => {
        const px = e.clientX / innerWidth - 0.5, py = e.clientY / innerHeight - 0.5;
        movers.forEach((m) => { m.x(px * m.k); m.y(py * m.k); });
      });
    }

    /* --- L'atelier : section épinglée, storytelling en 4 temps --- */
    (() => {
      const story = $('.story');
      const imgs = $$('.s-img'), steps = $$('.step'), nums = $$('.story__num span');
      if (!story || !steps.length) return;
      const N = steps.length;
      gsap.set(imgs, { opacity: 0, scale: 1.22 });
      gsap.set(imgs[0], { opacity: 1, scale: 1 });
      gsap.set(steps.slice(1), { opacity: 0, y: 40 });
      gsap.set(nums, { yPercent: (i) => i * 100 });
      const mobile = matchMedia('(max-width: 899px)').matches;
      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: { trigger: story, start: 'top top', end: mobile ? '+=240%' : '+=330%', pin: true, scrub: 0.7, anticipatePin: 1 }
      });
      for (let i = 1; i < N; i++) {
        const pos = i - 0.3;
        tl.to(steps[i - 1], { opacity: 0, y: -40, duration: 0.35 }, pos)
          .to(imgs[i - 1], { opacity: 0, scale: 0.9, duration: 0.55 }, pos)
          .to(imgs[i], { opacity: 1, scale: 1, duration: 0.75 }, pos)
          .fromTo(steps[i], { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5 }, pos + 0.22)
          .to(nums, { yPercent: (j) => (j - i) * 100, duration: 0.6 }, pos);
      }
      tl.fromTo('.story__rail i', { scaleY: 0.04 }, { scaleY: 1, ease: 'none', duration: N }, 0)
        .fromTo('.story__almond', { scale: 1 }, { scale: 1.07, ease: 'none', duration: N }, 0)
        .to({}, { duration: 0.01 }, N);
      pins.atelier = tl.scrollTrigger.start;
    })();

    /* --- Prestations : défilement horizontal (desktop) --- */
    const mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', () => {
      const svc = $('.svc'), track = $('#svcTrack');
      if (!svc || !track) return;
      svc.classList.add('is-hscroll');
      const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
      const tween = gsap.to(track, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: { trigger: svc, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1,
          onRefresh: (self) => { pins.prestations = self.start; } }
      });
      $$('.card__media:not(.card__media--duo) img').forEach((img) => {
        gsap.fromTo(img, { xPercent: -8 }, { xPercent: 8, ease: 'none',
          scrollTrigger: { trigger: img.closest('.card'), containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
      });
      // cartes déjà visibles à l'arrivée : entrée groupée ; les suivantes : entrée pendant le défilement horizontal
      const cards = $$('.card', track);
      const firstWave = cards.filter((c) => c.getBoundingClientRect().left < innerWidth * 0.9);
      gsap.from(firstWave, { y: 80, rotate: 2.5, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.1,
        scrollTrigger: { trigger: svc, start: 'top 75%', once: true } });
      cards.filter((c) => !firstWave.includes(c)).forEach((c) => {
        gsap.from(c, { y: 70, rotate: 2.5, opacity: 0, duration: 1, ease: 'power3.out',
          scrollTrigger: { trigger: c, containerAnimation: tween, start: 'left 96%', toggleActions: 'play none none reverse' } });
      });
      return () => svc.classList.remove('is-hscroll');
    });
    mm.add('(max-width: 899px)', () => {
      gsap.from('.svc .card', { y: 50, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, scrollTrigger: { trigger: '.svc__viewport', start: 'top 85%', once: true } });
    });

    /* --- Galerie : colonnes décalées + rideau + parallax dans le cadre --- */
    $$('.gal__col').forEach((col) => {
      const k = col.dataset.col;
      const amt = { 1: [3, -4], 2: [8, -10], 3: [2, -3] }[k] || [0, 0];
      gsap.fromTo(col, { yPercent: amt[0] }, { yPercent: amt[1], ease: 'none', scrollTrigger: { trigger: '.gal__cols', start: 'top bottom', end: 'bottom top', scrub: 0.6 } });
    });
    $$('.shot').forEach((shot) => {
      const frame = $('.shot__frame', shot), img = $('img', shot);
      const cur = document.createElement('i'); cur.className = 'curtain'; frame.appendChild(cur);
      gsap.set(cur, { scaleY: 1 });
      gsap.set(img, { scale: 1.35 });
      ScrollTrigger.create({
        trigger: shot, start: 'top 88%', once: true,
        onEnter: () => {
          gsap.to(cur, { scaleY: 0, duration: 1.2, ease: 'expo.inOut' });
          gsap.to(img, { scale: 1, duration: 1.6, ease: 'expo.out' });
        }
      });
      gsap.fromTo(img, { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: shot, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    /* --- Nuancier : entrée des ongles --- */
    gsap.from('.nail', { y: 160, opacity: 0, duration: 1.3, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: '.nuan__stage', start: 'top 80%', once: true } });
    gsap.from('.swatch', { scale: 0, duration: 0.8, ease: 'back.out(2)', stagger: 0.05, scrollTrigger: { trigger: '.swatches', start: 'top 92%', once: true } });

    /* --- Réservation --- */
    gsap.from('.ticket', { y: 120, rotate: 1.6, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.ticket', start: 'top 88%', once: true } });
    gsap.from('.book__how li', { x: -40, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.12, scrollTrigger: { trigger: '.book__how', start: 'top 88%', once: true } });
    gsap.to('.book__glow', { yPercent: 35, ease: 'none', scrollTrigger: { trigger: '.book', start: 'top bottom', end: 'bottom top', scrub: true } });

    /* --- Avis --- */
    gsap.from('.quote', { y: 90, rotate: 2, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: '.rev__track', start: 'top 88%', once: true } });
    gsap.fromTo('.rating__bar i', { scaleX: 0 }, { scaleX: 1, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '.rating', start: 'top 88%', once: true } });

    /* --- CTA : cercle holographique qui s'ouvre --- */
    gsap.fromTo('.cta__circle', { scale: 0.08 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.cta', start: 'top 85%', end: 'center 55%', scrub: true } });
    gsap.from('.cta__tel, .cta__actions', { y: 50, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.15, scrollTrigger: { trigger: '.cta__tel', start: 'top 92%', once: true } });

    /* --- Venir --- */
    gsap.from('.find__map', { y: 100, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.find__map', start: 'top 88%', once: true } });
    gsap.from('.hours tr', { x: -30, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.07, scrollTrigger: { trigger: '.hours', start: 'top 90%', once: true } });

    /* --- Footer : mot géant --- */
    (() => {
      const g = $('#footGiant span');
      if (!g) return;
      const chars = splitChars(g);
      gsap.set(chars, { yPercent: 115 });
      ScrollTrigger.create({
        trigger: '#footGiant', start: 'top 98%', once: true,
        onEnter: () => gsap.to(chars, { yPercent: 0, duration: 1.4, ease: 'expo.out', stagger: 0.05 })
      });
    })();

    /* --- Cartes (prestations) & photos (galerie) : inclinaison 3D + reflet œil-de-chat --- */
    if (fine) {
      const tilt = (el, max, glare) => {
        gsap.set(el, { transformPerspective: 900 });
        const rx = gsap.quickTo(el, 'rotationX', { duration: 0.6, ease: 'power3.out' });
        const ry = gsap.quickTo(el, 'rotationY', { duration: 0.6, ease: 'power3.out' });
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
          ry(px * max * 2); rx(-py * max * 2);
          if (glare) el.style.setProperty('--gx', `${(px + 0.5) * 270}%`);
        });
        el.addEventListener('pointerleave', () => { rx(0); ry(0); });
      };
      $$('.card__tilt').forEach((el) => tilt(el, 9, true));
      $$('.shot__frame').forEach((el) => tilt(el, 6, false));
    }

    /* --- boutons magnétiques --- */
    if (fine) {
      $$('.btn--magnetic').forEach((btn) => {
        const t = $('.btn__t', btn);
        btn.addEventListener('pointermove', (e) => {
          const r = btn.getBoundingClientRect();
          const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
          gsap.to(btn, { x: x * 0.28, y: y * 0.4, duration: 0.4, ease: 'power3.out', overwrite: 'auto' });
          if (t) gsap.to(t, { x: x * 0.12, y: y * 0.2, duration: 0.4, ease: 'power3.out', overwrite: 'auto' });
          btn.style.setProperty('--x', `${((e.clientX - r.left) / r.width) * 100}%`);
          btn.style.setProperty('--y', `${((e.clientY - r.top) / r.height) * 100}%`);
        });
        btn.addEventListener('pointerleave', () => {
          gsap.to(btn, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1,.4)', overwrite: 'auto' });
          if (t) gsap.to(t, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1,.4)', overwrite: 'auto' });
        });
      });

      /* --- curseur --- */
      const cur = $('.cursor');
      if (cur) {
        const cx = gsap.quickTo(cur, 'x', { duration: 0.35, ease: 'power3.out' });
        const cy = gsap.quickTo(cur, 'y', { duration: 0.35, ease: 'power3.out' });
        addEventListener('pointermove', (e) => { cx(e.clientX); cy(e.clientY); }, { passive: true });
        document.addEventListener('pointerover', (e) => {
          cur.classList.toggle('is-link', !!e.target.closest('a,button,.card__tilt,.shot,input,textarea'));
        });
      }
    }

    /* --- chargement final : refresh des positions --- */
    addEventListener('load', () => ScrollTrigger.refresh());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  /* ------------------------------------------------------------------ */
  /*  Loader + entrée du hero                                             */
  /* ------------------------------------------------------------------ */
  function runIntro() {
    const loader = $('#loader');
    const titleWords = $$('.hero__title [data-chars]');
    const chars = titleWords.flatMap((w) => splitChars(w));
    gsap.set(chars, { yPercent: 118, rotate: 7 });
    gsap.set(['.hero__eyebrow', '.hero__lead', '.hero__actions .btn', '.float', '.hero__badge', '.hero__scroll'], { opacity: 0 });

    const finishHero = () => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.fromTo('.hero__media video', { scale: 1.3 }, { scale: 1.04, duration: 3.2, ease: 'power2.out' }, 0)
        .fromTo('.hero__eyebrow', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 1 }, 0)
        .to(chars, { yPercent: 0, rotate: 0, duration: 1.5, stagger: 0.07 }, 0.05)
        .fromTo('.hero__lead', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.1 }, 0.55)
        .fromTo('.hero__actions .btn', { opacity: 0, y: 30, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 1, stagger: 0.12 }, 0.7)
        .fromTo('.float', { opacity: 0, y: 140, scale: 0.7, rotate: (i) => [-14, 10, -9][i] || 0 }, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 1.7, stagger: 0.16 }, 0.25)
        .fromTo('.hero__badge', { opacity: 0, scale: 0.3, rotate: -100 }, { opacity: 1, scale: 1, rotate: 0, duration: 1.5, ease: 'back.out(1.5)' }, 0.95)
        .fromTo('.hero__scroll', { opacity: 0 }, { opacity: 0.75, duration: 1 }, 1.3)
        .add(() => {
          // le mot « NAILS » reprend son vrai texte pour le dégradé holographique
          titleWords.forEach((w) => {
            if (w.classList.contains('holo')) { w.textContent = w.dataset.text; w.classList.add('is-shimmer'); }
          });
          lenis.start();
          ScrollTrigger.refresh();
        }, 1.9);
    };

    if (!loader) { finishHero(); return; }

    const count = $('#loaderCount'), fill = $('.loader__fill'), stroke = $('.loader__stroke'), nail = $('.loader__nail'), nm = $('.loader__name');
    const len = stroke.getTotalLength();
    gsap.set(stroke, { strokeDasharray: len, strokeDashoffset: len });
    gsap.set(fill, { y: 170 });
    gsap.set(nm, { opacity: 0, y: 12 });
    const o = { v: 0 };
    const tl = gsap.timeline();
    tl.to(stroke, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.out' })
      .to(nm, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2)
      .to(fill, { y: 0, duration: 1.3, ease: 'power2.inOut' }, 0.45)
      .to(o, { v: 100, duration: 1.3, ease: 'power2.inOut', onUpdate: () => { count.textContent = Math.round(o.v); } }, 0.45)
      .to(nm, { opacity: 0, duration: 0.3 }, 1.85)
      .to(nail, { scale: 46, duration: 1.05, ease: 'expo.in' }, 1.85)
      .add(() => finishHero(), 2.75)
      .to(loader, { opacity: 0, duration: 0.7, ease: 'power2.out', onComplete: () => loader.remove() }, 2.75);
  }

  /* ------------------------------------------------------------------ */
  /*  Démarrage                                                           */
  /* ------------------------------------------------------------------ */
  initMenu();
  initAnchors();
  initPrices();
  initHours();
  initReviews();
  const booking = initBooking();
  initNuancier(booking);
  initSparks();

  if (!canAnimate) {
    root.classList.add('no-anim');
    const l = $('#loader'); if (l) l.remove();
    initVideo();
    return;
  }

  // sécurité : si quelque chose bloque, on retire le loader après 9 s
  setTimeout(() => { const l = $('#loader'); if (l) { l.remove(); if (lenis) lenis.start(); } }, 9000);

  const go = () => { initMotion(); runIntro(); initVideo(); };
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1800))]).then(go);
  } else go();
})();
