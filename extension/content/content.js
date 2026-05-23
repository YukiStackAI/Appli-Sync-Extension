// ============================================================
// AppliSync v2 — Content Script
// Injects floating overlay, extracts page data, tracks forms
// ============================================================

(function () {
  'use strict';
  if (window.__appliSyncLoaded) return;
  window.__appliSyncLoaded = true;

  // ─── State ──────────────────────────────────────────────────
  const state = {
    overlayVisible:  false,
    extractedData:   null,
    formFields:      {},
    filesSubmitted:  [],
    isExtracting:    false,
    dragOffset:      { x: 0, y: 0 },
    isDragging:      false,
    position:        { right: 20, bottom: 20 },
  };

  // ─── Portal Detection ────────────────────────────────────────
  function detectPortal() {
    const h = location.hostname;
    if (h.includes('linkedin.com'))    return 'LinkedIn';
    if (h.includes('naukri.com'))      return 'Naukri';
    if (h.includes('indeed.com'))      return 'Indeed';
    if (h.includes('internshala.com')) return 'Internshala';
    if (h.includes('glassdoor.com'))   return 'Glassdoor';
    if (h.includes('wellfound.com'))   return 'Wellfound';
    if (h.includes('lever.co'))        return 'Lever';
    if (h.includes('greenhouse.io'))   return 'Greenhouse';
    if (h.includes('workday.com'))     return 'Workday';
    return 'Company Website';
  }

  function getPageHTML() {
    const host = location.hostname.toLowerCase();

    // ── Sync live form values into HTML attributes before any serialization ──
    // Typed text lives in .value (JS property) but outerHTML only reads
    // the value="" attribute — which stays empty. This bridges the gap.
    function syncFormValues(root) {
      if (!root) return;
      root.querySelectorAll('input, textarea, select').forEach(el => {
        try {
          if (el.tagName === 'TEXTAREA') {
            // For textareas, the text content IS the serialized value
            el.textContent = el.value;
          } else if (el.tagName === 'SELECT') {
            Array.from(el.options).forEach(opt => {
              if (opt.selected) opt.setAttribute('selected', 'selected');
              else opt.removeAttribute('selected');
            });
          } else if (el.tagName === 'INPUT') {
            if (el.type === 'checkbox' || el.type === 'radio') {
              if (el.checked) el.setAttribute('checked', 'checked');
              else el.removeAttribute('checked');
            } else if (el.type !== 'file') {
              el.setAttribute('value', el.value);
            }
          }
        } catch (_) { /* skip protected elements */ }
      });
    }

    // Sync the entire document first
    syncFormValues(document);

    // 1. LinkedIn
    if (host.includes('linkedin.com')) {
      const target = 
        document.querySelector('.jobs-search__job-details--container') || 
        document.querySelector('.jobs-description') ||
        document.querySelector('.jobs-description__container') ||
        document.querySelector('main.scaffold-layout__main') ||
        document.querySelector('#main-content') ||
        document.querySelector('#main');
      if (target) {
        return target.outerHTML;
      }
    }
    
    // 2. Naukri
    if (host.includes('naukri.com')) {
      const target = 
        document.querySelector('.jd-container') || 
        document.querySelector('.job-desc') ||
        document.querySelector('.left-sec') ||
        document.querySelector('#main-container');
      if (target) {
        return target.outerHTML;
      }
    }
    
    // 3. Indeed
    if (host.includes('indeed.com')) {
      const target = 
        document.querySelector('.jobsearch-JobComponent') || 
        document.querySelector('#jobDescriptionText') ||
        document.querySelector('#viewJobButtonLinkContainer');
      if (target) {
        return target.outerHTML;
      }
    }

    // 4. Deep-Serializer for custom portals (Phenom, Workday, Lever, Greenhouse, Google Forms, etc.)
    function deepSerialize(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }
      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe'].includes(tag)) {
        return '';
      }

      let html = `<${tag}`;
      
      // Serialize attributes
      if (node.attributes) {
        for (const attr of node.attributes) {
          if (attr.value && attr.value.length < 500) {
            html += ` ${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`;
          }
        }
      }

      // For input elements, inject the live .value if not already in attributes
      if (tag === 'input' && node.type !== 'file' && node.value) {
        if (!node.getAttribute('value')) {
          html += ` value="${node.value.replace(/"/g, '&quot;')}"`;
        }
      }

      html += '>';

      // For textarea, inject the live value as text content
      if (tag === 'textarea' && node.value) {
        html += node.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `</${tag}>`;
        return html;
      }
      
      // Expand Shadow DOM
      if (node.shadowRoot) {
        syncFormValues(node.shadowRoot);
        html += Array.from(node.shadowRoot.childNodes).map(deepSerialize).join('');
      }
      
      // Light DOM children
      html += Array.from(node.childNodes).map(deepSerialize).join('');
      
      html += `</${tag}>`;
      return html;
    }

    try {
      const serialized = deepSerialize(document.body);
      if (serialized && serialized.trim().length > 200) {
        return serialized;
      }
    } catch (e) {
      console.warn('[AppliSync] Shadow DOM serialization failed, falling back...', e);
    }

    // Ultimate Fallback
    return document.documentElement.outerHTML || document.body.innerHTML;
  }

  // ─── Form Field Tracker ──────────────────────────────────────
  function startFormTracking() {
    const SKIP_TYPES = ['password', 'hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio'];

    function captureField(el) {
      if (SKIP_TYPES.includes(el.type)) return;
      if (!el.value?.trim()) return;

      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        el.getAttribute('id') ||
        el.closest('[class*="field"], [class*="group"], [class*="form"]')
          ?.querySelector('label')?.innerText ||
        'Field';

      state.formFields[label.trim()] = el.value.trim();
    }

    function captureFile(el) {
      if (el.type !== 'file') return;
      Array.from(el.files || []).forEach(f => {
        if (!state.filesSubmitted.includes(f.name)) {
          state.filesSubmitted.push(f.name);
          updateOverlayFileCount();
        }
      });
    }

    // Track changes on all form elements
    const observer = new MutationObserver(() => {
      document.querySelectorAll('input, textarea, select').forEach(el => {
        if (el._appliTracked) return;
        el._appliTracked = true;
        el.addEventListener('change', () => { captureField(el); captureFile(el); });
        el.addEventListener('blur',   () => captureField(el));
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial scan
    document.querySelectorAll('input, textarea, select').forEach(el => {
      el._appliTracked = true;
      el.addEventListener('change', () => { captureField(el); captureFile(el); });
      el.addEventListener('blur',   () => captureField(el));
    });
  }

  // ─── Submit Detection ────────────────────────────────────────
  function watchForSubmit() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button, [role="button"], input[type="submit"], a');
      if (!btn) return;

      const text = (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').toLowerCase();
      const isSubmit = /submit|apply now|apply|send application|confirm apply/i.test(text);
      if (!isSubmit) return;

      // Snapshot form fields at submit time
      document.querySelectorAll('input, textarea, select').forEach(el => {
        const SKIP = ['password','hidden','submit','button','image','reset','file'];
        if (SKIP.includes(el.type) || !el.value?.trim()) return;
        const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || 'Field';
        state.formFields[label.trim()] = el.value.trim();
      });

      // Auto-save if overlay has extracted data
      if (state.extractedData && Object.keys(state.formFields).length > 0) {
        showOverlayStatus('📋 Form captured! Click Save to store.', 'info');
        updateOverlayFormBadge();
      }
    }, true);
  }

  // ─── Build Overlay ────────────────────────────────────────────
  function buildOverlay() {
    if (document.getElementById('as-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'as-overlay';
    overlay.innerHTML = `
      <div id="as-header">
        <div id="as-logo">
          <div id="as-logo-mark">A</div>
          <span>AppliSync</span>
        </div>
        <div id="as-header-btns">
          <button id="as-minimize" title="Minimize">─</button>
          <button id="as-close" title="Close">✕</button>
        </div>
      </div>

      <div id="as-body">

        <!-- Auth Gate -->
        <div id="as-auth-gate" class="as-section">
          <p class="as-hint">Sign in to start tracking</p>
          <input id="as-email" type="email" placeholder="Email" autocomplete="email"/>
          <input id="as-pass"  type="password" placeholder="Password"/>
          <button id="as-signin" class="as-btn as-btn-primary">Sign In</button>
          <div id="as-auth-err" class="as-error"></div>
        </div>

        <!-- Main Panel -->
        <div id="as-main" class="as-section" style="display:none">

          <!-- Portal Badge -->
          <div id="as-portal-row">
            <span id="as-portal-badge">${detectPortal()}</span>
            <span id="as-url-short">${location.hostname}</span>
          </div>

          <!-- Test Scrape Button -->
          <button id="as-scrape" class="as-btn as-btn-scrape">
            <span id="as-scrape-icon">🔍</span>
            <span id="as-scrape-text">Test Scrape · Raw Text Only</span>
          </button>

          <!-- Raw Scrape Results Panel -->
          <div id="as-scrape-results" style="display:none">
            <div id="as-scrape-meta" class="as-scrape-meta"></div>
            <textarea id="as-scrape-output" readonly placeholder="Raw scraped text will appear here..."></textarea>
          </div>

          <div class="as-divider"></div>

          <!-- Extract Button -->
          <button id="as-extract" class="as-btn as-btn-primary">
            <span id="as-extract-icon">⚡</span>
            <span id="as-extract-text">Extract This Page</span>
          </button>

          <!-- Extracted Fields -->
          <div id="as-fields" style="display:none">
            <div class="as-field-group">
              <label>Company</label>
              <input id="as-f-company" type="text" placeholder="—"/>
            </div>
            <div class="as-field-group">
              <label>Role</label>
              <input id="as-f-role" type="text" placeholder="—"/>
            </div>
            <div class="as-field-row">
              <div class="as-field-group">
                <label>Experience</label>
                <input id="as-f-exp" type="text" placeholder="Fresher"/>
              </div>
              <div class="as-field-group">
                <label>Location</label>
                <input id="as-f-loc" type="text" placeholder="—"/>
              </div>
            </div>
            <div class="as-field-row">
              <div class="as-field-group">
                <label>Salary</label>
                <input id="as-f-sal" type="text" placeholder="—"/>
              </div>
              <div class="as-field-group">
                <label>Posted</label>
                <input id="as-f-date" type="text" placeholder="—"/>
              </div>
            </div>
            <div class="as-field-row">
              <div class="as-field-group">
                <label>Mode of Work</label>
                <input id="as-f-mode" type="text" placeholder="NA"/>
              </div>
              <div class="as-field-group">
                <label>Skills Required</label>
                <input id="as-f-skills" type="text" placeholder="NA"/>
              </div>
            </div>
            <div class="as-field-group">
              <label>Important Info</label>
              <input id="as-f-imp" type="text" placeholder="NA"/>
            </div>
            <div class="as-field-group">
              <label>Notes</label>
              <input id="as-f-notes" type="text" placeholder="Add notes..."/>
            </div>

            <!-- JD Preview -->
            <details class="as-jd-toggle">
              <summary>Job Description <span id="as-jd-chars"></span></summary>
              <div id="as-jd-preview"></div>
            </details>

            <!-- Raw Scraped Content Toggle -->
            <details class="as-jd-toggle" style="margin-top: 8px;">
              <summary>Raw Scraped Page Text <span id="as-scraped-chars"></span></summary>
              <textarea id="as-scraped-preview" readonly style="width: 100%; height: 120px; background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; color: rgba(255, 255, 255, 0.7); font-family: monospace; font-size: 11px; padding: 8px; resize: vertical; margin-top: 6px; box-sizing: border-box; outline: none;"></textarea>
            </details>

            <!-- Captured indicators -->
            <div id="as-captures">
              <div id="as-form-badge" class="as-badge" style="display:none">
                📋 <span id="as-form-count">0</span> form fields
              </div>
              <div id="as-file-badge" class="as-badge" style="display:none">
                📎 <span id="as-file-list"></span>
              </div>
            </div>

            <!-- Save -->
            <button id="as-save" class="as-btn as-btn-save">
              💾 Save Application
            </button>
          </div>

          <!-- Status message -->
          <div id="as-status" class="as-status"></div>

        </div>
      </div>

      <!-- Minimized pill -->
      <div id="as-pill" style="display:none">
        <div id="as-logo-mark-sm">A</div>
        <span>AppliSync</span>
      </div>
    `;

    document.body.appendChild(overlay);
    initOverlayEvents(overlay);
    startFormTracking();
    watchForSubmit();
    checkAuthState();
  }

  // ─── Overlay Events ──────────────────────────────────────────
  function initOverlayEvents(overlay) {
    // Drag
    const header = overlay.querySelector('#as-header');
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      state.isDragging  = true;
      const rect = overlay.getBoundingClientRect();
      state.dragOffset  = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      overlay.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!state.isDragging) return;
      const x = e.clientX - state.dragOffset.x;
      const y = e.clientY - state.dragOffset.y;
      overlay.style.left   = `${Math.max(0, x)}px`;
      overlay.style.top    = `${Math.max(0, y)}px`;
      overlay.style.right  = 'auto';
      overlay.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => { state.isDragging = false; });

    // Minimize
    overlay.querySelector('#as-minimize').addEventListener('click', () => {
      overlay.querySelector('#as-body').style.display = 'none';
      overlay.querySelector('#as-pill').style.display = 'flex';
      overlay.querySelector('#as-header-btns').style.display = 'none';
    });

    overlay.querySelector('#as-pill').addEventListener('click', () => {
      overlay.querySelector('#as-body').style.display = 'block';
      overlay.querySelector('#as-pill').style.display = 'none';
      overlay.querySelector('#as-header-btns').style.display = 'flex';
    });

    // Close
    overlay.querySelector('#as-close').addEventListener('click', () => {
      overlay.style.display = 'none';
      // Restore via extension icon click
    });

    // Sign in
    overlay.querySelector('#as-signin').addEventListener('click', handleOverlaySignIn);
    overlay.querySelector('#as-pass').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleOverlaySignIn();
    });

    // Extract
    overlay.querySelector('#as-extract').addEventListener('click', handleExtract);

    // Scrape Only
    overlay.querySelector('#as-scrape').addEventListener('click', handleScrape);

    // Save
    overlay.querySelector('#as-save').addEventListener('click', handleSave);
  }

  // ─── Auth ────────────────────────────────────────────────────
  async function checkAuthState() {
    const res = await msg('GET_SESSION');
    if (res?.data) {
      showMain();
    }
  }

  async function handleOverlaySignIn() {
    const email = document.getElementById('as-email').value.trim();
    const pass  = document.getElementById('as-pass').value;
    const errEl = document.getElementById('as-auth-err');
    const btn   = document.getElementById('as-signin');

    errEl.textContent = '';
    btn.textContent   = 'Signing in...';
    btn.disabled      = true;

    const res = await msg('SIGN_IN', { email, password: pass });

    btn.textContent = 'Sign In';
    btn.disabled    = false;

    if (res?.ok) {
      showMain();
    } else {
      errEl.textContent = res?.error || 'Sign in failed';
    }
  }

  function showMain() {
    document.getElementById('as-auth-gate').style.display = 'none';
    document.getElementById('as-main').style.display      = 'block';
  }

  // ─── Scrape Only (No LLM) ─────────────────────────────────────
  async function handleScrape() {
    const btn     = document.getElementById('as-scrape');
    const icon    = document.getElementById('as-scrape-icon');
    const txtEl   = document.getElementById('as-scrape-text');
    const results = document.getElementById('as-scrape-results');
    const metaEl  = document.getElementById('as-scrape-meta');
    const output  = document.getElementById('as-scrape-output');
    const statusEl = document.getElementById('as-status');

    icon.textContent     = '⏳';
    txtEl.textContent    = 'Scraping page...';
    btn.disabled         = true;
    statusEl.textContent = '';

    try {
      const html = getPageHTML();
      const htmlSize = new Blob([html]).size;
      const res  = await msg('SCRAPE_PAGE', { html, url: location.href });

      if (!res?.ok) throw new Error(res?.error || 'Scrape failed');

      const d = res.data;

      // Show metadata
      metaEl.innerHTML = `
        <div class="as-meta-row"><span class="as-meta-label">Portal</span><span class="as-meta-value">${d.portal}</span></div>
        <div class="as-meta-row"><span class="as-meta-label">URL</span><span class="as-meta-value as-meta-url">${location.hostname}${location.pathname.slice(0, 40)}</span></div>
        <div class="as-meta-row"><span class="as-meta-label">HTML Sent</span><span class="as-meta-value">${(htmlSize / 1024).toFixed(1)} KB</span></div>
        <div class="as-meta-row"><span class="as-meta-label">Text Extracted</span><span class="as-meta-value as-meta-highlight">${d.char_count.toLocaleString()} chars</span></div>
      `;

      // Show raw text
      output.value = d.scraped_text || '(empty — no text extracted)';
      results.style.display = 'block';

      if (d.char_count > 200) {
        showOverlayStatus(`✅ Scraped ${d.char_count.toLocaleString()} chars from ${d.portal}`, 'success');
      } else {
        showOverlayStatus(`⚠️ Only ${d.char_count} chars extracted — page may need different selectors`, 'info');
      }

    } catch (e) {
      showOverlayStatus('❌ ' + e.message, 'error');
    } finally {
      icon.textContent  = '🔍';
      txtEl.textContent = 'Re-Scrape · Raw Text Only';
      btn.disabled      = false;
    }
  }

  // ─── Extract ─────────────────────────────────────────────────
  async function handleExtract() {
    if (state.isExtracting) return;
    state.isExtracting = true;

    const btn     = document.getElementById('as-extract');
    const icon    = document.getElementById('as-extract-icon');
    const txtEl   = document.getElementById('as-extract-text');
    const fields  = document.getElementById('as-fields');
    const statusEl= document.getElementById('as-status');

    icon.style.animation = 'as-spin 1s linear infinite';
    txtEl.textContent    = 'Extracting...';
    btn.disabled         = true;
    statusEl.textContent = '';

    try {
      const html = getPageHTML();
      const res  = await msg('EXTRACT_PAGE', { html, url: location.href });

      if (!res?.ok) throw new Error(res?.error || 'Extraction failed');

      const d = res.data;
      state.extractedData = { ...d, portal: detectPortal(), job_url: location.href };

      // Populate fields
      setField('as-f-company', d.company || 'NA');
      setField('as-f-role',    d.role || 'NA');
      setField('as-f-exp',     d.experience_required || 'Fresher');
      setField('as-f-loc',     d.location || 'NA');
      setField('as-f-sal',     d.salary || 'NA');
      setField('as-f-date',    d.posting_date || 'NA');
      setField('as-f-mode',    d.mode_of_work || 'NA');
      setField('as-f-skills',  d.skills_required || 'NA');
      setField('as-f-imp',     d.important_information || 'NA');

      if (d.job_description) {
        document.getElementById('as-jd-preview').textContent = d.job_description.slice(0, 600) + '...';
        document.getElementById('as-jd-chars').textContent   = `(${d.job_description.length} chars)`;
      }

      if (d.scraped_text) {
        const scrPreview = document.getElementById('as-scraped-preview');
        const scrChars = document.getElementById('as-scraped-chars');
        if (scrPreview) scrPreview.value = d.scraped_text;
        if (scrChars) scrChars.textContent = `(${d.scraped_text.length} chars)`;
      }

      fields.style.display = 'block';
      showOverlayStatus('✅ Extracted! Review and save.', 'success');

    } catch (e) {
      showOverlayStatus('❌ ' + e.message, 'error');
    } finally {
      icon.style.animation = '';
      txtEl.textContent    = 'Re-Extract';
      btn.disabled         = false;
      state.isExtracting   = false;
    }
  }

  // ─── Save ────────────────────────────────────────────────────
  async function handleSave() {
    const btn = document.getElementById('as-save');
    btn.textContent = '⟳ Saving...';
    btn.disabled    = true;

    // Build beautiful consolidated notes line-by-line
    const notesParts = [];

    // 1. Manual User Notes
    const manualNotes = getField('as-f-notes')?.trim();
    if (manualNotes) {
      notesParts.push(`📝 Notes:\n${manualNotes}`);
    }



    // 3. User Filled Form Fields
    if (state.formFields && Object.keys(state.formFields).length > 0) {
      const formLines = ["📋 Form Details Filled:"];
      for (const [key, value] of Object.entries(state.formFields)) {
        if (value && value.trim()) {
          formLines.push(`   • ${key}: ${value.trim()}`);
        }
      }
      if (formLines.length > 1) {
        notesParts.push(formLines.join('\n'));
      }
    }

    // 4. Uploaded Files
    if (state.filesSubmitted && state.filesSubmitted.length > 0) {
      const fileLines = ["📎 Attached Files:"];
      state.filesSubmitted.forEach(f => {
        if (f) fileLines.push(`   • ${f}`);
      });
      if (fileLines.length > 1) {
        notesParts.push(fileLines.join('\n'));
      }
    }

    const compiledNotes = notesParts.join('\n\n') || null;

    // Read edited fields from overlay inputs
    const data = {
      portal:              detectPortal(),
      company:             getField('as-f-company'),
      role:                getField('as-f-role'),
      experience_required: getField('as-f-exp') || 'Fresher',
      location:            getField('as-f-loc'),
      salary:              getField('as-f-sal'),
      posting_date:        getField('as-f-date'),
      job_description:     state.extractedData?.job_description || null,
      job_url:             location.href,
      notes:               compiledNotes,
      mode_of_work:          getField('as-f-mode'),
      skills_required:       getField('as-f-skills'),
      important_information: getField('as-f-imp'),
      form_fields:         state.formFields,
      files_submitted:     state.filesSubmitted,
    };

    const res = await msg('SAVE_APPLICATION', { data });

    if (res?.ok) {
      showOverlayStatus('✅ Saved to AppliSync!', 'success');
      btn.textContent = '✅ Saved!';
      // Reset form tracking for next page
      state.formFields    = {};
      state.filesSubmitted= [];
      updateOverlayFormBadge();
      updateOverlayFileCount();
    } else {
      showOverlayStatus('❌ ' + (res?.error || 'Save failed'), 'error');
      btn.textContent = '💾 Save Application';
    }

    btn.disabled = false;
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function setField(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  }

  function getField(id) {
    return document.getElementById(id)?.value?.trim() || null;
  }

  function showOverlayStatus(text, type = 'info') {
    const el = document.getElementById('as-status');
    if (!el) return;
    el.textContent  = text;
    el.className    = `as-status as-status--${type}`;
    el.style.display= 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  function updateOverlayFormBadge() {
    const count = Object.keys(state.formFields).length;
    const badge = document.getElementById('as-form-badge');
    const cnt   = document.getElementById('as-form-count');
    if (!badge) return;
    if (count > 0) {
      badge.style.display = 'flex';
      cnt.textContent     = count;
    } else {
      badge.style.display = 'none';
    }
  }

  function updateOverlayFileCount() {
    const badge = document.getElementById('as-file-badge');
    const list  = document.getElementById('as-file-list');
    if (!badge) return;
    if (state.filesSubmitted.length > 0) {
      badge.style.display = 'flex';
      list.textContent    = state.filesSubmitted.join(', ');
    } else {
      badge.style.display = 'none';
    }
  }

  function msg(type, payload = {}) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, res => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res);
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  // ─── Listen for popup "show overlay" ────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SHOW_OVERLAY') {
      const overlay = document.getElementById('as-overlay');
      if (overlay) {
        overlay.style.display = 'block';
        // Restore body and header buttons visibility
        const body = overlay.querySelector('#as-body');
        const pill = overlay.querySelector('#as-pill');
        const headerBtns = overlay.querySelector('#as-header-btns');
        if (body) body.style.display = 'block';
        if (pill) pill.style.display = 'none';
        if (headerBtns) headerBtns.style.display = 'flex';
      } else {
        buildOverlay();
      }
    }
  });

  // ─── Init ────────────────────────────────────────────────────
  buildOverlay();

})();
