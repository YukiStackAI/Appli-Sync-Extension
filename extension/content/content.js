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

    // Deep-Serializer recursively flattens Shadow DOM and injects live input values as text
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

      html += '>';

      // ── AGGRESSIVE VALUE EXTRACTION ──
      // Some portals (like MS Forms) use custom elements or heavily obfuscated inputs.
      // Instead of checking for tag === 'input', we check if ANY node has a string .value property
      // or is contenteditable, and forcefully inject that value as visible text.
      try {
        if (typeof node.value === 'string' && node.value.trim() !== '' && node.type !== 'hidden' && node.type !== 'password') {
          html += ` [USER INPUT: ${node.value.replace(/</g, '&lt;').replace(/>/g, '&gt;')}] `;
        } else if (node.isContentEditable) {
          const textVal = node.innerText || node.textContent;
          if (textVal && textVal.trim() !== '') {
            html += ` [USER INPUT: ${textVal.replace(/</g, '&lt;').replace(/>/g, '&gt;')}] `;
          }
        }
      } catch (_) {}

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

    // Sync the entire document first
    syncFormValues(document);

    // Capture the entire page using deepSerialize for maximum compatibility on company pages
    try {
      const serialized = deepSerialize(document.body);
      if (serialized && serialized.trim().length > 200) {
        return serialized;
      }
    } catch (e) {
      console.warn('[AppliSync] Serialization failed, falling back...', e);
    }

    // Ultimate Fallback
    return document.documentElement.outerHTML || document.body.innerHTML;
  }

  // ─── Form Field Tracker ──────────────────────────────────────


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

            <!-- Save -->
            <button id="as-save" class="as-btn as-btn-save">
              💾 Save Application
            </button>
          </div>

          <!-- Status message -->
          <div id="as-status"></div>
        </div>

      </div>
    `;

    document.body.appendChild(overlay);

    // Bind Auth
    document.getElementById('as-signin').addEventListener('click', async () => {
      const e = document.getElementById('as-email').value;
      const p = document.getElementById('as-pass').value;
      const err = document.getElementById('as-auth-err');
      try {
        const res = await msg('SIGN_IN', { email: e, password: p });
        if (res.ok) checkAuth();
        else err.textContent = res.error || 'Failed to sign in';
      } catch (ex) {
        err.textContent = 'Network error';
      }
    });

    // Window controls
    document.getElementById('as-close').addEventListener('click', () => {
      overlay.style.display = 'none';
      if (document.getElementById('as-pill')) document.getElementById('as-pill').remove();
    });

    document.getElementById('as-minimize').addEventListener('click', () => {
      document.getElementById('as-body').style.display = 'none';
      document.getElementById('as-header').style.display = 'none';
      
      const pill = document.createElement('div');
      pill.id = 'as-pill';
      pill.innerHTML = `<span>A</span><span>AppliSync</span>`;
      pill.addEventListener('click', () => {
        pill.remove();
        document.getElementById('as-body').style.display = 'flex';
        document.getElementById('as-header').style.display = 'flex';
      });
      document.body.appendChild(pill);
    });

    // Scrape Only
    overlay.querySelector('#as-scrape').addEventListener('click', handleScrape);

    // Extract
    overlay.querySelector('#as-extract').addEventListener('click', handleExtract);

    // Save
    overlay.querySelector('#as-save').addEventListener('click', handleSave);

    checkAuth();
  }

  function showOverlayStatus(text, type='info') {
    const el = document.getElementById('as-status');
    if (!el) return;
    el.textContent = text;
    el.className = `as-status-${type}`;
  }

  function getField(id) { return document.getElementById(id)?.value?.trim() || null; }
  function setField(id, val) { 
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  // ─── Auth Check ───────────────────────────────────────────────
  async function checkAuth() {
    const res = await msg('GET_SESSION');
    if (res?.ok && res.data) {
      document.getElementById('as-auth-gate').style.display = 'none';
      document.getElementById('as-main').style.display = 'flex';
    } else {
      document.getElementById('as-auth-gate').style.display = 'flex';
      document.getElementById('as-main').style.display = 'none';
    }
  }

  // ─── Scrape Only (No LLM) ─────────────────────────────────────
  async function handleScrape() {
    const btn     = document.getElementById('as-scrape');
    const icon    = document.getElementById('as-scrape-icon');
    const txtEl   = document.getElementById('as-scrape-text');
    const resEl   = document.getElementById('as-scrape-results');
    const outEl   = document.getElementById('as-scrape-output');
    const metaEl  = document.getElementById('as-scrape-meta');

    icon.style.animation = 'as-spin 1s linear infinite';
    txtEl.textContent    = 'Scraping...';
    btn.disabled         = true;
    
    try {
      const html = getPageHTML();
      const htmlSize = new Blob([html]).size;
      const res  = await msg('SCRAPE_PAGE', { html, url: location.href });

      if (!res?.ok) throw new Error(res?.error || 'Scrape failed');

      const d = res.data;
      
      resEl.style.display = 'flex';
      outEl.value = d.scraped_text || 'No text extracted.';
      
      metaEl.innerHTML = `
        <div><strong>Portal:</strong> ${d.portal}</div>
        <div><strong>HTML Size Sent:</strong> ${(htmlSize / 1024).toFixed(1)} KB</div>
        <div><strong>Chars Extracted:</strong> ${d.char_count.toLocaleString()}</div>
      `;

      if (d.char_count > 200) {
        showOverlayStatus(`✅ Scraped ${d.char_count.toLocaleString()} chars from ${d.portal}`, 'success');
      } else {
        showOverlayStatus(`⚠️ Only ${d.char_count} chars extracted — page may need different selectors`, 'info');
      }
    } catch (e) {
      showOverlayStatus('❌ ' + e.message, 'error');
    } finally {
      icon.style.animation = '';
      txtEl.textContent    = 'Re-Scrape · Raw Text Only';
      btn.disabled         = false;
    }
  }

  // ─── Extract ─────────────────────────────────────────────────
  async function handleExtract() {
    const btn     = document.getElementById('as-extract');
    const fields  = document.getElementById('as-fields');

    btn.disabled = true;
    try {
      const html = getPageHTML();
      const res  = await msg('EXTRACT_PAGE', { html, url: location.href });

      if (!res?.ok) throw new Error(res?.error || 'Extraction failed');

      const d = res.data;
      
      setField('as-f-company', d.company || 'NA');
      setField('as-f-role',    d.role || 'NA');
      setField('as-f-exp',     d.experience_required || 'Fresher');
      setField('as-f-loc',     d.location || 'NA');
      setField('as-f-sal',     d.salary || 'NA');
      setField('as-f-date',    d.posting_date || 'NA');
      setField('as-f-mode',    d.mode_of_work || 'NA');
      setField('as-f-skills',  d.skills_required || 'NA');
      setField('as-f-notes',   d.notes || '');

      if (d.job_description) {
        document.getElementById('as-jd-preview').textContent = d.job_description.slice(0, 600) + '...';
        document.getElementById('as-jd-chars').textContent   = `(${d.job_description.length} chars)`;
      }

      fields.style.display = 'block';
      showOverlayStatus('✅ Extracted!', 'success');
    } catch (e) {
      showOverlayStatus('❌ ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Save ────────────────────────────────────────────────────
  async function handleSave() {
    const btn = document.getElementById('as-save');
    btn.textContent = '⟳ Saving...';
    btn.disabled    = true;

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
      notes:               getField('as-f-notes'),
      mode_of_work:        getField('as-f-mode'),
      skills_required:     getField('as-f-skills'),
    };

    const res = await msg('SAVE_APPLICATION', { data });

    if (res?.ok) {
      showOverlayStatus('✅ Saved to AppliSync!', 'success');
      btn.textContent = '✅ Saved!';
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
