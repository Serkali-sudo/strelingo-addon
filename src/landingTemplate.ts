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
    align-items: flex-start;
    justify-content: center;
    padding: 24px;
    background: linear-gradient(135deg, #0d0b1a 0%, #1a1030 40%, #0d0b1a 100%);
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
}

.card {
    /* auto margins keep the card centered while still allowing the page to scroll
       when the form is taller than the viewport (flex centering alone clips the top). */
    margin: auto;
}

.subtitle-bg {
    position: fixed;
    inset: 0;
    z-index: -2;
    overflow: hidden;
    pointer-events: none;
}

.bg-particles {
    position: fixed;
    inset: 0;
    z-index: -2;
    overflow: hidden;
    pointer-events: none;
}

.bg-particle {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,255,255,0) 70%);
    animation: twinkle ease-in-out infinite;
    will-change: opacity, transform;
}

@keyframes twinkle {
    0%, 100% { opacity: 0.12; transform: scale(0.6); }
    50% { opacity: 0.9; transform: scale(1); }
}

.bg-aurora {
    position: fixed;
    width: 60vmax;
    height: 60vmax;
    border-radius: 50%;
    filter: blur(80px);
    z-index: -3;
    opacity: 0.35;
    pointer-events: none;
    will-change: transform;
}

.bg-aurora-1 {
    top: -22vmax;
    left: -16vmax;
    background: radial-gradient(circle, rgba(138, 90, 171, 0.55), transparent 70%);
    animation: auroraDrift1 26s ease-in-out infinite;
}

.bg-aurora-2 {
    bottom: -26vmax;
    right: -20vmax;
    background: radial-gradient(circle, rgba(79, 209, 197, 0.4), transparent 70%);
    animation: auroraDrift2 32s ease-in-out infinite;
}

@keyframes auroraDrift1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(6vmax, 4vmax) scale(1.15); }
}

@keyframes auroraDrift2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(-5vmax, -6vmax) scale(1.1); }
}

.subtitle-pair {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    opacity: 0;
    will-change: transform, opacity;
}

.sub-chip {
    display: inline-block;
    padding: 5px 13px;
    border-radius: 8px;
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    font-weight: 600;
    font-size: 13.5px;
    line-height: 1.3;
    white-space: nowrap;
    background: rgba(8, 6, 18, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.sub-chip-main {
    color: #fdfdfd;
}

.sub-chip-trans {
    color: var(--pair-color, #f1c40f);
    border-color: var(--pair-color, #f1c40f);
    border-color: color-mix(in srgb, var(--pair-color, #f1c40f) 45%, transparent);
}

.sub-connector {
    width: 2px;
    height: 8px;
    margin-left: 17px;
    background: linear-gradient(var(--pair-color, #f1c40f), transparent);
    border-radius: 1px;
    opacity: 0.75;
}

@keyframes floatUp1 {
    0% { transform: translateY(110vh) translateX(0) rotate(-1deg); opacity: 0; }
    8% { opacity: 0.55; }
    92% { opacity: 0.55; }
    100% { transform: translateY(-20vh) translateX(40px) rotate(1deg); opacity: 0; }
}

@keyframes floatUp2 {
    0% { transform: translateY(110vh) translateX(0) rotate(1.5deg); opacity: 0; }
    10% { opacity: 0.45; }
    90% { opacity: 0.45; }
    100% { transform: translateY(-20vh) translateX(-30px) rotate(-1deg); opacity: 0; }
}

@keyframes floatUp3 {
    0% { transform: translateY(110vh) translateX(0) rotate(-0.5deg); opacity: 0; }
    6% { opacity: 0.5; }
    94% { opacity: 0.5; }
    100% { transform: translateY(-20vh) translateX(20px) rotate(0.5deg); opacity: 0; }
}

@keyframes floatUp4 {
    0% { transform: translateY(110vh) translateX(0) rotate(2deg); opacity: 0; }
    12% { opacity: 0.4; }
    88% { opacity: 0.4; }
    100% { transform: translateY(-20vh) translateX(-50px) rotate(-2deg); opacity: 0; }
}

@keyframes floatUp5 {
    0% { transform: translateY(110vh) translateX(0) rotate(-1.5deg); opacity: 0; }
    9% { opacity: 0.48; }
    91% { opacity: 0.48; }
    100% { transform: translateY(-20vh) translateX(35px) rotate(1.5deg); opacity: 0; }
}

@keyframes floatUp6 {
    0% { transform: translateY(110vh) translateX(0) rotate(0.5deg); opacity: 0; }
    7% { opacity: 0.52; }
    93% { opacity: 0.52; }
    100% { transform: translateY(-20vh) translateX(-20px) rotate(-0.5deg); opacity: 0; }
}

@keyframes floatUp7 {
    0% { transform: translateY(110vh) translateX(0) rotate(-2deg); opacity: 0; }
    11% { opacity: 0.38; }
    89% { opacity: 0.38; }
    100% { transform: translateY(-20vh) translateX(45px) rotate(2deg); opacity: 0; }
}

@keyframes floatUp8 {
    0% { transform: translateY(110vh) translateX(0) rotate(1deg); opacity: 0; }
    8% { opacity: 0.42; }
    92% { opacity: 0.42; }
    100% { transform: translateY(-20vh) translateX(-35px) rotate(-1deg); opacity: 0; }
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
    transform-style: preserve-3d;
    transition: transform 0.15s ease-out;
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
    animation: badgePulse 3s ease-in-out infinite;
}

@keyframes badgePulse {
    0%, 100% { box-shadow: 0 0 0 rgba(138, 90, 171, 0); }
    50% { box-shadow: 0 0 12px rgba(138, 90, 171, 0.55); }
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
    font-weight: 600;
    color: var(--accent-light);
    margin-bottom: 16px;
    min-height: 20px;
    letter-spacing: 0.2px;
    text-shadow: 0 0 14px var(--accent-glow);
    transition: color 0.2s ease;
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
}

.form-group input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
}

.custom-select-wrapper {
    position: relative;
    width: 100%;
}

.custom-select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 11px 16px;
    font-size: 14px;
    font-family: inherit;
    font-weight: 500;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.03) 100%);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    user-select: none;
    backdrop-filter: blur(8px);
}

.custom-select-trigger:hover {
    border-color: rgba(138, 90, 171, 0.5);
    background: linear-gradient(135deg, rgba(138, 90, 171, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%);
    box-shadow: 0 4px 20px rgba(138, 90, 171, 0.15);
}

.custom-select-trigger.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow), 0 8px 32px rgba(138, 90, 171, 0.2);
    background: linear-gradient(135deg, rgba(138, 90, 171, 0.15) 0%, rgba(255, 255, 255, 0.08) 100%);
}

.custom-select-trigger .select-value {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.custom-select-trigger .select-arrow {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    color: var(--text-dim);
    flex-shrink: 0;
    margin-left: 8px;
}

.custom-select-trigger.active .select-arrow {
    transform: rotate(180deg);
    color: var(--accent-light);
}

.custom-select-options {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    background: linear-gradient(180deg, rgba(30, 20, 50, 0.98) 0%, rgba(20, 15, 35, 0.98) 100%);
    backdrop-filter: blur(24px) saturate(1.5);
    -webkit-backdrop-filter: blur(24px) saturate(1.5);
    border: 1px solid rgba(138, 90, 171, 0.3);
    border-radius: var(--radius-sm);
    padding: 6px;
    z-index: 100;
    opacity: 0;
    visibility: hidden;
    transform: translateY(-8px) scale(0.98);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6), 0 0 60px rgba(138, 90, 171, 0.15);
    max-height: 240px;
    overflow-y: auto;
    overflow-x: hidden;
}

.custom-select-options::-webkit-scrollbar {
    width: 6px;
}

.custom-select-options::-webkit-scrollbar-track {
    background: transparent;
}

.custom-select-options::-webkit-scrollbar-thumb {
    background: rgba(138, 90, 171, 0.3);
    border-radius: 3px;
}

.custom-select-options::-webkit-scrollbar-thumb:hover {
    background: rgba(138, 90, 171, 0.5);
}

.custom-select-options.open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0) scale(1);
}

.custom-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    font-size: 13.5px;
    font-family: inherit;
    color: var(--text-dim);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
    overflow: hidden;
}

.custom-option::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(138, 90, 171, 0.2) 0%, transparent 100%);
    opacity: 0;
    transition: opacity 0.15s ease;
}

.custom-option:hover {
    color: var(--text);
}

.custom-option:hover::before {
    opacity: 1;
}

.custom-option.selected {
    color: var(--accent-light);
    font-weight: 600;
    background: rgba(138, 90, 171, 0.12);
}

.custom-option.selected::after {
    content: '';
    position: absolute;
    right: 12px;
    width: 6px;
    height: 6px;
    background: var(--accent-light);
    border-radius: 50%;
    box-shadow: 0 0 8px var(--accent-glow);
}

.custom-option .option-flag {
    font-size: 16px;
    flex-shrink: 0;
    width: 20px;
    text-align: center;
}

.custom-option .option-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

.field-help {
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-dim);
    margin-top: 6px;
}

.section-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 4px 0;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    color: var(--text-dim);
    transition: color 0.2s;
}

.section-toggle:hover {
    color: var(--text);
}

.section-toggle .section-label {
    margin-bottom: 0;
}

.section-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-light);
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.section-toggle.open .section-chevron {
    transform: rotate(180deg);
}

.collapsible-content {
    display: none;
    padding-top: 8px;
}

.collapsible-content.open {
    display: block;
    animation: fadeIn 0.25s ease both;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
}

.field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
}

.field-label-row label {
    margin-bottom: 0;
}

.get-key-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    font-size: 11.5px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 20px;
    color: var(--accent-light);
    background: rgba(138, 90, 171, 0.12);
    border: 1px solid rgba(138, 90, 171, 0.3);
    text-decoration: none;
    transition: all 0.2s ease;
}

.get-key-btn:hover {
    background: rgba(138, 90, 171, 0.25);
    border-color: var(--accent);
    color: var(--text);
}

.get-key-btn svg {
    width: 11px;
    height: 11px;
}

.multiselect {
    width: 100%;
}

.ms-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.ms-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 11px;
    font-size: 12.5px;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border);
    border-radius: 20px;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
}

.ms-chip:hover {
    border-color: rgba(138, 90, 171, 0.5);
    color: var(--text);
}

.ms-chip input[type="checkbox"] {
    accent-color: var(--accent);
    width: 14px;
    height: 14px;
    margin: 0;
    cursor: pointer;
}

.ms-chip:has(input:checked) {
    background: rgba(138, 90, 171, 0.18);
    border-color: var(--accent);
    color: var(--text);
}

.actions {
    display: flex;
    gap: 10px;
    margin-top: 24px;
}

.btn {
    position: relative;
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
    overflow: hidden;
}

.btn::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 -60%;
    width: 40%;
    background: linear-gradient(120deg, transparent, rgba(255, 255, 255, 0.35), transparent);
    transform: skewX(-20deg);
    transition: left 0.6s ease;
    pointer-events: none;
}

.btn:hover::before {
    left: 130%;
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

.warning {
    background: rgba(231, 76, 60, 0.15);
    border: 1px solid rgba(231, 76, 60, 0.3);
    color: #ff8a80;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    margin-bottom: 16px;
    text-align: center;
    display: none;
}

.btn-disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: grayscale(0.6);
    pointer-events: none;
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

.confetti-piece {
    position: fixed;
    top: 0;
    left: 0;
    width: 7px;
    height: 7px;
    border-radius: 2px;
    pointer-events: none;
    z-index: 2000;
    animation: confettiBurst 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes confettiBurst {
    0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
    100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.4); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
    .subtitle-bg, .bg-particles, .bg-aurora {
        display: none;
    }
    .card {
        transition: none;
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
        type: 'text' | 'number' | 'password' | 'checkbox' | 'select' | 'multiselect';
        title: string;
        required?: boolean;
        default?: string;
        options?: Array<string | { value: string; label: string }>;
        /** Optional helper text rendered under the field (e.g. usage limits). */
        description?: string;
        /** Optional section heading rendered before this field. */
        section?: string;
        /** Optional "get the key" link rendered next to the field label. */
        link?: { label: string; url: string };
        /** For `select` fields: pre-select the visitor's own browser language
         * client-side (via navigator.languages), instead of baking a
         * server-detected default into the HTML. Keeps the page cacheable
         * since it no longer needs to vary per visitor. */
        browserDetect?: boolean;
    }>;
    githubUrl?: string;
}

interface LandingTemplateOptions {
    /** Maps a lowercased BCP-47 tag (e.g. "tr", "pt-br") to this addon's
     * 3-letter language code, for client-side browser-language detection.
     * Only needed when a `select` field sets `browserDetect: true`. */
    browserLangMap?: Record<string, string>;
}

export default function landingTemplate(manifest: Manifest, opts: LandingTemplateOptions = {}): string {
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
        let lastSection = '';
        let sectionIdx = 0;
        let collapsibleOpen = false;
        const normalizeOptions = (opts: any): Array<{ value: string; label: string }> =>
            (opts || []).map((o: any) => (typeof o === 'string' ? { value: o, label: o } : o));
        manifest.config?.forEach(elem => {
            const key = elem.key;

            // A `section` starts a collapsible group (collapsed by default). Fields
            // after it with no section of their own stay inside the same group.
            if (elem.section && elem.section !== lastSection) {
                lastSection = elem.section;
                if (collapsibleOpen) options += `</div>`;
                const sectionId = `section-${sectionIdx++}`;
                options += `
                <div class="divider"></div>
                <button type="button" class="section-toggle" data-target="${sectionId}">
                    <span class="section-label">${elem.section}</span>
                    <span class="section-chevron"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                </button>
                <div class="collapsible-content" id="${sectionId}">`;
                collapsibleOpen = true;
            }

            const helpHTML = elem.description
                ? `<div class="field-help">${elem.description}</div>`
                : '';

            const linkHTML = elem.link
                ? `<a class="get-key-btn" href="${elem.link.url}" target="_blank" rel="noopener noreferrer">${elem.link.label}<svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3h7v7M13 3L6.5 9.5M11 9.5V13H3V5h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`
                : '';

            if (['text', 'number', 'password'].includes(elem.type)) {
                const isRequired = elem.required ? ' required' : '';
                const defaultHTML = elem.default ? ` value="${elem.default}"` : '';
                const inputType = elem.type;
                options += `
                <div class="form-group">
                    <div class="field-label-row">
                        <label for="${key}">${elem.title}</label>
                        ${linkHTML}
                    </div>
                    <input type="${inputType}" id="${key}" name="${key}"${defaultHTML}${isRequired}/>
                    ${helpHTML}
                </div>`;
            } else if (elem.type === 'checkbox') {
                const isChecked = elem.default === 'checked' ? ' checked' : '';
                options += `
                <div class="form-group">
                    <label for="${key}">
                        <input type="checkbox" id="${key}" name="${key}"${isChecked}/>
                        <span class="checkbox-label">${elem.title}</span>
                    </label>
                    ${helpHTML}
                </div>`;
            } else if (elem.type === 'select') {
                const selections = normalizeOptions(elem.options);
                const defaultValue = elem.default || (selections[0] ? selections[0].value : '');
                const defaultLabel = (selections.find((o: any) => o.value === defaultValue) || {}).label || defaultValue;
                let optionsHTML = '';
                selections.forEach((el: any) => {
                    const isSelected = el.value === defaultValue;
                    optionsHTML += `<div class="custom-option${isSelected ? ' selected' : ''}" data-value="${el.value}"><span class="option-label">${el.label}</span></div>`;
                });
                const autoDetectAttr = elem.browserDetect ? ' data-auto-detect="1"' : '';
                options += `
                <div class="form-group">
                    <label for="${key}">${elem.title}</label>
                    <div class="custom-select-wrapper" data-key="${key}"${autoDetectAttr}>
                        <input type="hidden" id="${key}" name="${key}" value="${defaultValue || ''}">
                        <div class="custom-select-trigger" tabindex="0">
                            <span class="select-value">${defaultLabel || 'Select...'}</span>
                            <span class="select-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                        </div>
                        <div class="custom-select-options">
                            ${optionsHTML}
                        </div>
                    </div>
                    ${helpHTML}
                </div>`;
            } else if (elem.type === 'multiselect') {
                const selections = normalizeOptions(elem.options);
                const selectedSet = new Set(String(elem.default || '').split(',').map(s => s.trim()).filter(Boolean));
                let chipsHTML = '';
                selections.forEach((el: any) => {
                    const isChecked = selectedSet.has(el.value) ? ' checked' : '';
                    chipsHTML += `<label class="ms-chip"><input type="checkbox" value="${el.value}"${isChecked}/><span>${el.label}</span></label>`;
                });
                options += `
                <div class="form-group">
                    <label>${elem.title}</label>
                    <div class="multiselect" data-key="${key}">
                        <input type="hidden" id="${key}" name="${key}" value="${[...selectedSet].join(',')}">
                        <div class="ms-options">${chipsHTML}</div>
                    </div>
                    ${helpHTML}
                </div>`;
            }
        });
        if (collapsibleOpen) options += `</div>`;
        if (options.length) {
            formHTML = `
            <div class="section-label">Configuration</div>
            <form id="mainForm">
                ${options}
            </form>
            <div id="langWarning" class="warning">
                <strong>Warning:</strong> Main Language and Translation Language cannot be the same. Please select different languages.
            </div>
            <div class="divider"></div>`;
            script += `
            document.querySelectorAll('.section-toggle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const target = document.getElementById(btn.dataset.target);
                    if (!target) return;
                    const isOpen = target.classList.toggle('open');
                    btn.classList.toggle('open', isOpen);
                });
            });

            document.querySelectorAll('.custom-select-wrapper').forEach(wrapper => {
                const trigger = wrapper.querySelector('.custom-select-trigger');
                const optionsContainer = wrapper.querySelector('.custom-select-options');
                const hiddenInput = wrapper.querySelector('input[type="hidden"]');
                const valueDisplay = wrapper.querySelector('.select-value');
                const optionElements = wrapper.querySelectorAll('.custom-option');

                trigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.custom-select-wrapper').forEach(w => {
                        if (w !== wrapper) {
                            w.querySelector('.custom-select-trigger').classList.remove('active');
                            w.querySelector('.custom-select-options').classList.remove('open');
                        }
                    });
                    trigger.classList.toggle('active');
                    optionsContainer.classList.toggle('open');
                });

                trigger.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        trigger.click();
                    } else if (e.key === 'Escape') {
                        trigger.classList.remove('active');
                        optionsContainer.classList.remove('open');
                    }
                });

                optionElements.forEach(option => {
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const value = option.dataset.value;
                        const label = option.querySelector('.option-label').textContent;
                        hiddenInput.value = value;
                        valueDisplay.textContent = label;
                        optionElements.forEach(o => o.classList.remove('selected'));
                        option.classList.add('selected');
                        trigger.classList.remove('active');
                        optionsContainer.classList.remove('open');
                        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                });
            });

            document.addEventListener('click', () => {
                document.querySelectorAll('.custom-select-wrapper').forEach(w => {
                    w.querySelector('.custom-select-trigger').classList.remove('active');
                    w.querySelector('.custom-select-options').classList.remove('open');
                });
            });

            // Multi-select chips (e.g. Wyzie sources): collect checked values into
            // the single comma-separated hidden input that FormData submits.
            document.querySelectorAll('.multiselect').forEach(ms => {
                const hiddenInput = ms.querySelector('input[type="hidden"]');
                const boxes = ms.querySelectorAll('.ms-options input[type="checkbox"]');
                boxes.forEach(box => {
                    box.addEventListener('change', () => {
                        const selected = Array.from(boxes).filter(b => b.checked).map(b => b.value);
                        hiddenInput.value = selected.join(',');
                        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                });
            });

            // Auto-select the visitor's own browser language, client-side, for any
            // select field marked browserDetect (see index.ts). Runs once at
            // render time using navigator.languages so the HTML itself can stay
            // identical (and cacheable) for every visitor.
            (() => {
                const langMap = ${JSON.stringify(opts.browserLangMap || {})};
                const wrappers = document.querySelectorAll('.custom-select-wrapper[data-auto-detect="1"]');
                if (!wrappers.length) return;

                const browserTags = (navigator.languages && navigator.languages.length)
                    ? navigator.languages
                    : [navigator.language || 'en'];

                let code3 = null;
                for (const tag of browserTags) {
                    const lower = String(tag).toLowerCase();
                    if (langMap[lower]) { code3 = langMap[lower]; break; }
                    const primary = lower.split('-')[0];
                    if (langMap[primary]) { code3 = langMap[primary]; break; }
                }
                if (!code3) return;

                wrappers.forEach(wrapper => {
                    const option = wrapper.querySelector('.custom-option[data-value$="[' + code3 + ']"]');
                    if (!option) return;
                    const hiddenInput = wrapper.querySelector('input[type="hidden"]');
                    const valueDisplay = wrapper.querySelector('.select-value');
                    wrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                    option.classList.add('selected');
                    hiddenInput.value = option.dataset.value;
                    valueDisplay.textContent = option.querySelector('.option-label').textContent;
                });
            })();

            const updateLink = () => {
                const config = Object.fromEntries(
                    Array.from(new FormData(mainForm).entries()).filter(([, v]) => String(v).trim() !== '')
                )
                const configPath = '/' + encodeURIComponent(JSON.stringify(config))
                const manifestPath = configPath + '/manifest.json'

                installLink.href = 'stremio://' + window.location.host + manifestPath
                webInstallLink.href = 'https://web.strem.io/#/addons?addon=' + encodeURIComponent(window.location.protocol + '//' + window.location.host + manifestPath)
                copyLinkBtn.dataset.url = window.location.protocol + '//' + window.location.host + manifestPath

                const mainSel = document.getElementById('mainLang')
                const transSel = document.getElementById('transLang')
                const mainWrapper = mainSel ? mainSel.closest('.custom-select-wrapper') : null
                const transWrapper = transSel ? transSel.closest('.custom-select-wrapper') : null
                const mainL = mainWrapper ? mainWrapper.querySelector('.select-value').textContent.split(' [')[0] : ''
                const transL = transWrapper ? transWrapper.querySelector('.select-value').textContent.split(' [')[0] : ''
                const langLabel = document.getElementById('langLabel')
                const langWarning = document.getElementById('langWarning')
                const isSame = mainL === transL

                if (langLabel && mainL && transL) {
                    if (isSame) {
                        langLabel.textContent = mainL + ' + ' + transL
                        langLabel.style.color = '#e74c3c'
                    } else {
                        langLabel.textContent = mainL + ' → ' + transL
                        langLabel.style.color = ''
                    }
                }

                if (langWarning) {
                    langWarning.style.display = isSame ? 'block' : 'none'
                }

                if (isSame) {
                    installLink.classList.add('btn-disabled')
                    webInstallLink.classList.add('btn-disabled')
                } else {
                    installLink.classList.remove('btn-disabled')
                    webInstallLink.classList.remove('btn-disabled')
                }
            }
            mainForm.onchange = updateLink

            installLink.onclick = (e) => {
                const mainSel = document.getElementById('mainLang')
                const transSel = document.getElementById('transLang')
                const mainWrapper = mainSel ? mainSel.closest('.custom-select-wrapper') : null
                const transWrapper = transSel ? transSel.closest('.custom-select-wrapper') : null
                const mainL = mainWrapper ? mainWrapper.querySelector('.select-value').textContent.split(' [')[0] : ''
                const transL = transWrapper ? transWrapper.querySelector('.select-value').textContent.split(' [')[0] : ''
                if (mainL === transL) {
                    e.preventDefault()
                    return false
                }
                return mainForm.reportValidity()
            }
            webInstallLink.addEventListener('click', (e) => {
                const mainSel = document.getElementById('mainLang')
                const transSel = document.getElementById('transLang')
                const mainWrapper = mainSel ? mainSel.closest('.custom-select-wrapper') : null
                const transWrapper = transSel ? transSel.closest('.custom-select-wrapper') : null
                const mainL = mainWrapper ? mainWrapper.querySelector('.select-value').textContent.split(' [')[0] : ''
                const transL = transWrapper ? transWrapper.querySelector('.select-value').textContent.split(' [')[0] : ''
                if (mainL === transL) {
                    e.preventDefault()
                    return false
                }
                if (!mainForm.reportValidity()) { e.preventDefault(); return false; }
            })`;
        }
    }

    const typeIcon = (t: string) => {
        const low = t.toLowerCase();
        if (low.includes('movie')) return '🎬';
        if (low.includes('series')) return '📺';
        return '🎞️';
    };
    const typePills = stylizedTypes.map(t => `<span class="type-pill">${typeIcon(t)} ${t}</span>`).join('');

    const descHtml = manifest.description
        ? manifest.description
            .replace(/<br\s*\/?>/gi, '<br>')
            .replace(/<a\s[^>]*href="[^"]*github[^"]*"[^>]*>[^<]*<\/a>\s*/gi, '')
            .replace(/<a\s/g, '<a target="_blank" ')
            .trim()
        : '';

    // Each pair renders as two stacked "subtitle chips" (one per language) linked
    // by a small connector — a nod to the addon's whole premise: two languages,
    // always paired. `color` gives each drifting pair its own accent so the
    // background reads as lively and varied rather than a monochrome wash.
    const subtitlePairs = [
        { l1: 'May the Force be with you', l2: 'Que la fuerza te acompañe', anim: 'floatUp1', dur: '28s', delay: '0s', left: '5%', color: '#f1c40f' },
        { l1: "I'll be back", l2: '我还会回来的', anim: 'floatUp2', dur: '22s', delay: '4s', left: '55%', color: '#ff6b81' },
        { l1: 'To infinity and beyond', l2: 'हमेशा के लिए और उससे आगे', anim: 'floatUp3', dur: '32s', delay: '8s', left: '25%', color: '#4fd1c5' },
        { l1: 'Why so serious?', l2: 'لماذا هذا الجد؟', anim: 'floatUp4', dur: '26s', delay: '12s', left: '70%', color: '#ff9f43' },
        { l1: 'Hasta la vista, baby', l2: 'Até logo, baby', anim: 'floatUp5', dur: '24s', delay: '2s', left: '40%', color: '#54a0ff' },
        { l1: 'I see dead people', l2: 'Я вижу мёртвых людей', anim: 'floatUp6', dur: '30s', delay: '6s', left: '10%', color: '#a870c8' },
        { l1: 'You talkin\' to me?', l2: '俺に話しかけてるのか？', anim: 'floatUp7', dur: '20s', delay: '10s', left: '60%', color: '#1dd1a1' },
        { l1: "There's no place like home", l2: 'Kein Ort wie zu Hause', anim: 'floatUp8', dur: '34s', delay: '14s', left: '35%', color: '#ff6b6b' },
        { l1: 'Just keep swimming', l2: '그냥 계속 헤엄쳐', anim: 'floatUp1', dur: '29s', delay: '16s', left: '75%', color: '#feca57' },
        { l1: 'I am your father', l2: 'Sono tuo padre', anim: 'floatUp2', dur: '25s', delay: '18s', left: '15%', color: '#48dbfb' },
        { l1: 'You shall not pass', l2: 'Geçemeyeceksin', anim: 'floatUp3', dur: '31s', delay: '20s', left: '50%', color: '#ff9ff3' },
        { l1: 'Here\'s looking at you, kid', l2: 'ดูที่เธอสิ เด็กน้อย', anim: 'floatUp4', dur: '23s', delay: '22s', left: '80%', color: '#00d2d3' },
    ];

    const subtitleBgHTML = subtitlePairs.map((p) =>
        `<div class="subtitle-pair" style="left:${p.left};animation:${p.anim} ${p.dur} linear ${p.delay} infinite;--pair-color:${p.color}">` +
        `<span class="sub-chip sub-chip-main">${p.l1}</span>` +
        `<span class="sub-connector"></span>` +
        `<span class="sub-chip sub-chip-trans">${p.l2}</span>` +
        `</div>`
    ).join('\n');

    // Ambient twinkling particles. Positions/timings are derived deterministically
    // from the index (not Math.random()) so the rendered HTML — and therefore the
    // page's edge cache — stays byte-identical across requests.
    const particleCount = 26;
    const particlesHTML = Array.from({ length: particleCount }, (_, i) => {
        const left = (i * 37) % 100;
        const top = (i * 53 + 11) % 100;
        const size = 2 + (i % 4);
        const dur = 4 + (i % 6);
        const delay = ((i % 10) * 0.6).toFixed(1);
        return `<span class="bg-particle" style="left:${left}%;top:${top}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;"></span>`;
    }).join('');

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
    <div class="bg-aurora bg-aurora-1"></div>
    <div class="bg-aurora bg-aurora-2"></div>
    <div class="bg-particles">${particlesHTML}</div>
    <div class="subtitle-bg">${subtitleBgHTML}</div>
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

        // Fun, purely-decorative micro-interactions: a subtle 3D tilt on the
        // card and a confetti burst on Install/Web Install. Skipped for touch
        // devices (no hover/tilt) and prefers-reduced-motion.
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const isFinePointer = window.matchMedia('(pointer: fine)').matches
        const card = document.querySelector('.card')

        if (card && !prefersReducedMotion && isFinePointer) {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect()
                const x = (e.clientX - rect.left) / rect.width - 0.5
                const y = (e.clientY - rect.top) / rect.height - 0.5
                card.style.transform = 'rotateY(' + (x * 4).toFixed(2) + 'deg) rotateX(' + (-y * 4).toFixed(2) + 'deg)'
            })
            card.addEventListener('mouseleave', () => {
                card.style.transform = ''
            })
        }

        function burstConfetti(x, y) {
            if (prefersReducedMotion) return
            const colors = ['#8A5AAB', '#f1c40f', '#4fd1c5', '#ff6b81', '#54a0ff', '#1dd1a1']
            for (let i = 0; i < 18; i++) {
                const piece = document.createElement('div')
                piece.className = 'confetti-piece'
                const angle = Math.random() * Math.PI * 2
                const dist = 60 + Math.random() * 80
                piece.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(0) + 'px')
                piece.style.setProperty('--dy', (Math.sin(angle) * dist - 40).toFixed(0) + 'px')
                piece.style.setProperty('--rot', (Math.random() * 480 - 240).toFixed(0) + 'deg')
                piece.style.left = x + 'px'
                piece.style.top = y + 'px'
                piece.style.background = colors[i % colors.length]
                document.body.appendChild(piece)
                piece.addEventListener('animationend', () => piece.remove())
            }
        }

        ;[installLink, webInstallLink].forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (btn.classList.contains('btn-disabled')) return
                burstConfetti(e.clientX, e.clientY)
            })
        })

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