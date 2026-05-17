const STYLESHEET = `
*, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

:root {
    --accent: #8A5AAB;
    --accent-light: #a870c8;
    --accent-dark: #6b3f88;
    --accent-glow: rgba(138, 90, 171, 0.35);
    --surface: rgba(255, 255, 255, 0.06);
    --surface-hover: rgba(255, 255, 255, 0.1);
    --border: rgba(255, 255, 255, 0.1);
    --text: #f0f0f5;
    --text-dim: rgba(255, 255, 255, 0.6);
    --success: #4CAF7D;
    --radius: 12px;
    --radius-sm: 8px;
}

html, body {
    width: 100%;
    min-height: 100vh;
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: linear-gradient(135deg, #0d0b1a 0%, #1a1030 40%, #0d0b1a 100%);
    position: relative;
    overflow-x: hidden;
}

.bg-layer {
    position: fixed;
    inset: 0;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    filter: blur(2px) brightness(0.3);
    z-index: -2;
}

body::after {
    content: '';
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse at 30% 20%, rgba(138, 90, 171, 0.15) 0%, transparent 60%),
                radial-gradient(ellipse at 70% 80%, rgba(100, 60, 160, 0.1) 0%, transparent 50%);
    z-index: -1;
    pointer-events: none;
}

.card {
    position: relative;
    width: 100%;
    max-width: 480px;
    background: var(--surface);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 40px 36px 32px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 0 120px var(--accent-glow);
    animation: cardIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes cardIn {
    from { opacity: 0; transform: translateY(20px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

.logo-wrap {
    width: 72px;
    height: 72px;
    margin: 0 auto 20px;
    border-radius: 16px;
    overflow: hidden;
    background: linear-gradient(135deg, var(--accent), var(--accent-dark));
    box-shadow: 0 8px 32px var(--accent-glow);
    animation: logoIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
}

@keyframes logoIn {
    from { opacity: 0; transform: scale(0.7); }
    to { opacity: 1; transform: scale(1); }
}

.logo-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.title {
    font-size: 22px;
    font-weight: 700;
    text-align: center;
    letter-spacing: -0.3px;
    margin-bottom: 2px;
}

.header-row {
    text-align: center;
    margin-bottom: 6px;
}

.badge {
    position: absolute;
    top: 14px;
    right: 16px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--accent-light);
    background: rgba(138, 90, 171, 0.15);
    border: 1px solid rgba(138, 90, 171, 0.25);
    border-radius: 20px;
    padding: 2px 10px;
}

.github-link {
    position: absolute;
    top: 14px;
    left: 16px;
    color: var(--text-dim);
    transition: color 0.2s;
    display: flex;
    align-items: center;
}

.github-link:hover {
    color: var(--text);
}

.github-link svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
}

.lang-label {
    text-align: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--accent-light);
    margin-bottom: 16px;
    min-height: 20px;
}

.description {
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-dim);
    text-align: center;
    margin-bottom: 24px;
}

.description a {
    color: var(--accent-light);
    text-decoration: none;
    font-weight: 500;
}

.description a:hover {
    text-decoration: underline;
}

.types-row {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-bottom: 24px;
    flex-wrap: wrap;
}

.type-pill {
    font-size: 12px;
    font-weight: 500;
    padding: 4px 14px;
    border-radius: 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-dim);
}

.divider {
    height: 1px;
    background: var(--border);
    margin: 20px 0;
}

.section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 14px;
}

.form-group {
    margin-bottom: 16px;
}

.form-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 6px;
    color: var(--text);
}

.form-group select,
.form-group input[type="text"],
.form-group input[type="number"],
.form-group input[type="password"] {
    width: 100%;
    padding: 10px 14px;
    font-size: 14px;
    font-family: inherit;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    appearance: none;
    -webkit-appearance: none;
}

.form-group select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='rgba(255,255,255,0.5)' viewBox='0 0 16 16'%3E%3Cpath d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    background-size: 14px;
    padding-right: 36px;
    cursor: pointer;
}

.form-group select:focus,
.form-group input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
}

.form-group select option {
    background: #1a1030;
    color: var(--text);
}

.form-group input[type="checkbox"] {
    accent-color: var(--accent);
    margin-right: 6px;
    width: 16px;
    height: 16px;
    vertical-align: middle;
}

.form-group .checkbox-label {
    font-size: 13px;
    color: var(--text);
    vertical-align: middle;
    cursor: pointer;
}

.actions {
    display: flex;
    gap: 10px;
    margin-top: 24px;
}

.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    padding: 11px 20px;
    border-radius: var(--radius-sm);
    border: none;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    text-decoration: none;
    user-select: none;
    flex: 1;
    min-width: 0;
}

.btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-dark));
    color: white;
    box-shadow: 0 4px 16px var(--accent-glow);
}

.btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 24px var(--accent-glow);
}

.btn-primary:active {
    transform: translateY(0);
}

.btn-secondary {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
}

.btn-secondary:hover {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.2);
}

.btn-secondary:active {
    background: rgba(255, 255, 255, 0.14);
}

.btn.copied {
    background: var(--success) !important;
    border-color: var(--success) !important;
    color: white !important;
    box-shadow: 0 4px 16px rgba(76, 175, 125, 0.3) !important;
}

.toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: var(--success);
    color: white;
    padding: 10px 20px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
    z-index: 1000;
    box-shadow: 0 8px 32px rgba(76, 175, 125, 0.3);
}

.toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

.contact {
    margin-top: 24px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
}

.contact a {
    color: var(--accent-light);
    text-decoration: none;
}

.contact a:hover {
    text-decoration: underline;
}

@media (max-width: 520px) {
    .card {
        padding: 28px 20px 24px;
        border-radius: 16px;
    }
    .title {
        font-size: 19px;
    }
    .actions {
        flex-direction: column;
    }
    .btn {
        flex: none;
    }
}
`;

export interface Manifest {
    id: string;
    version: string;
    name: string;
    description?: string;
    background?: string;
    logo?: string;
    contactEmail?: string;
    types: string[];
    resources: string[];
    subtitleExtra?: string[];
    idPrefixes?: string[];
    catalogs?: any[];
    behaviorHints?: {
        configurable?: boolean;
        configurationRequired?: boolean;
    };
    stremioAddonsConfig?: {
        issuer: string;
        signature: string;
    };
    config?: Array<{
        key: string;
        type: 'text' | 'number' | 'password' | 'checkbox' | 'select';
        title: string;
        required?: boolean;
        default?: string;
        options?: string[];
    }>;
    githubUrl?: string;
}

export default function landingTemplate(manifest: Manifest): string {
    const background = manifest.background || 'https://dl.strem.io/addon-background.jpg';
    const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png';
    const githubUrl = manifest.githubUrl || '';
    const contactHTML = manifest.contactEmail ?
        `<div class="contact">
            <p>Contact creator: <a href="mailto:${manifest.contactEmail}">${manifest.contactEmail}</a></p>
        </div>` : '';

    const githubIcon = githubUrl ? `<a class="github-link" href="${githubUrl}" target="_blank" title="GitHub"><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>` : '';

    const stylizedTypes = manifest.types
        .map(t => t[0].toUpperCase() + t.slice(1) + (t !== 'series' ? 's' : ''));

    let formHTML = '';
    let script = '';

    if ((manifest.config || []).length) {
        let options = '';
        manifest.config?.forEach(elem => {
            const key = elem.key;
            if (['text', 'number', 'password'].includes(elem.type)) {
                const isRequired = elem.required ? ' required' : '';
                const defaultHTML = elem.default ? ` value="${elem.default}"` : '';
                const inputType = elem.type;
                options += `
                <div class="form-group">
                    <label for="${key}">${elem.title}</label>
                    <input type="${inputType}" id="${key}" name="${key}"${defaultHTML}${isRequired}/>
                </div>`;
            } else if (elem.type === 'checkbox') {
                const isChecked = elem.default === 'checked' ? ' checked' : '';
                options += `
                <div class="form-group">
                    <label for="${key}">
                        <input type="checkbox" id="${key}" name="${key}"${isChecked}/>
                        <span class="checkbox-label">${elem.title}</span>
                    </label>
                </div>`;
            } else if (elem.type === 'select') {
                const defaultValue = elem.default || (elem.options || [])[0];
                options += `
                <div class="form-group">
                    <label for="${key}">${elem.title}</label>
                    <select id="${key}" name="${key}">
                    `;
                const selections = elem.options || [];
                selections.forEach(el => {
                    const isSelected = el === defaultValue ? ' selected' : '';
                    options += `<option value="${el}"${isSelected}>${el}</option>`;
                });
                options += `</select></div>`;
            }
        });
        if (options.length) {
            formHTML = `
            <div class="section-label">Configuration</div>
            <form id="mainForm">
                ${options}
            </form>
            <div class="divider"></div>`;
            script += `
            const updateLink = () => {
                const config = Object.fromEntries(new FormData(mainForm))
                const configPath = '/' + encodeURIComponent(JSON.stringify(config))
                const manifestPath = configPath + '/manifest.json'

                installLink.href = 'stremio://' + window.location.host + manifestPath
                webInstallLink.href = 'https://web.strem.io/#/addons?addon=' + encodeURIComponent(window.location.protocol + '//' + window.location.host + manifestPath)
                copyLinkBtn.dataset.url = window.location.protocol + '//' + window.location.host + manifestPath

                const mainSel = document.getElementById('mainLang')
                const transSel = document.getElementById('transLang')
                const mainL = mainSel ? mainSel.options[mainSel.selectedIndex].text.split(' [')[0] : ''
                const transL = transSel ? transSel.options[transSel.selectedIndex].text.split(' [')[0] : ''
                const langLabel = document.getElementById('langLabel')
                if (langLabel && mainL && transL) {
                    if (mainL === transL) {
                        langLabel.textContent = mainL + ' + ' + transL
                        langLabel.style.color = '#e74c3c'
                    } else {
                        langLabel.textContent = mainL + ' → ' + transL
                        langLabel.style.color = ''
                    }
                }
            }
            mainForm.onchange = updateLink

            installLink.onclick = () => mainForm.reportValidity()
            webInstallLink.addEventListener('click', (e) => {
                if (!mainForm.reportValidity()) { e.preventDefault(); return false; }
            })`;
        }
    }

    const typePills = stylizedTypes.map(t => `<span class="type-pill">${t}</span>`).join('');

    const descHtml = manifest.description
        ? manifest.description
            .replace(/<br\s*\/?>/gi, '<br>')
            .replace(/<a\s[^>]*href="[^"]*github[^"]*"[^>]*>[^<]*<\/a>\s*/gi, '')
            .replace(/<a\s/g, '<a target="_blank" ')
            .trim()
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${manifest.name} - Stremio Addon</title>
    <link rel="shortcut icon" href="${logo}" type="image/x-icon">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>${STYLESHEET}</style>
</head>
<body>
    <div class="bg-layer" style="background-image: url(${background})"></div>
    <div class="card">
        ${githubIcon}
        <span class="badge">v${manifest.version || '0.0.0'}</span>
        <div class="logo-wrap"><img src="${logo}" alt="${manifest.name}"></div>
        <div class="header-row">
            <h1 class="title">${manifest.name}</h1>
        </div>
        <div id="langLabel" class="lang-label"></div>
        <p class="description">${descHtml}</p>

        <div class="types-row">${typePills}</div>

        ${formHTML}

        <div class="actions">
            <a id="installLink" class="btn btn-primary" href="#">Install</a>
            <a id="webInstallLink" class="btn btn-secondary" href="#" target="_blank">Web Install</a>
            <button id="copyLinkBtn" class="btn btn-secondary" data-url="#">Copy Link</button>
        </div>

        ${contactHTML}
    </div>

    <div id="toast" class="toast">&#10003; Link copied to clipboard</div>

    <script>
        ${script}

        copyLinkBtn.onclick = async () => {
            const url = copyLinkBtn.dataset.url
            try {
                await navigator.clipboard.writeText(url)
                const toast = document.getElementById('toast')
                toast.classList.add('show')
                setTimeout(() => toast.classList.remove('show'), 2000)
                const orig = copyLinkBtn.textContent
                copyLinkBtn.textContent = 'Copied!'
                copyLinkBtn.classList.add('copied')
                setTimeout(() => { copyLinkBtn.textContent = orig; copyLinkBtn.classList.remove('copied') }, 2000)
            } catch (err) {
                const textArea = document.createElement('textarea')
                textArea.value = url
                textArea.style.cssText = 'position:fixed;left:-9999px'
                document.body.appendChild(textArea)
                textArea.select()
                try {
                    document.execCommand('copy')
                    const toast = document.getElementById('toast')
                    toast.classList.add('show')
                    setTimeout(() => toast.classList.remove('show'), 2000)
                } catch (e) {
                    alert('Failed to copy. URL: ' + url)
                }
                document.body.removeChild(textArea)
            }
        }

        if (typeof updateLink === 'function') {
            updateLink()
        } else {
            const manifestPath = '/manifest.json'
            installLink.href = 'stremio://' + window.location.host + manifestPath
            webInstallLink.href = 'https://web.strem.io/#/addons?addon=' + encodeURIComponent(window.location.protocol + '//' + window.location.host + manifestPath)
            copyLinkBtn.dataset.url = window.location.protocol + '//' + window.location.host + manifestPath
        }
    </script>
</body>
</html>`;
}