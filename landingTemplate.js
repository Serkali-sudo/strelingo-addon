const STYLESHEET = `
* {
	box-sizing: border-box;
}

body,
html {
	margin: 0;
	padding: 0;
	width: 100%;
	min-height: 100%;
}

body {
	padding: 2vh;
	font-size: 2.2vh;
}

html {
	background-size: auto 100%;
	background-size: cover;
	background-position: center center;
	background-repeat: no-repeat;
	box-shadow: inset 0 0 0 2000px rgb(0 0 0 / 60%);
}

body {
	display: flex;
	font-family: 'Open Sans', Arial, sans-serif;
	color: white;
}

h1 {
	font-size: 4.5vh;
	font-weight: 700;
}

h2 {
	font-size: 2.2vh;
	font-weight: normal;
	font-style: italic;
	opacity: 0.8;
}

h3 {
	font-size: 2.2vh;
}

h1,
h2,
h3,
p {
	margin: 0;
	text-shadow: 0 0 1vh rgba(0, 0, 0, 0.15);
}

p {
	font-size: 1.75vh;
}

ul {
	font-size: 1.75vh;
	margin: 0;
	margin-top: 1vh;
	padding-left: 3vh;
}

a {
	color: white
}

a.install-link {
	text-decoration: none
}

button {
	border: 0;
	outline: 0;
	color: white;
	background: #8A5AAB;
	padding: 1.2vh 3.5vh;
	margin: auto;
	text-align: center;
	font-family: 'Open Sans', Arial, sans-serif;
	font-size: 2.2vh;
	font-weight: 600;
	cursor: pointer;
	display: block;
	box-shadow: 0 0.5vh 1vh rgba(0, 0, 0, 0.2);
	transition: box-shadow 0.1s ease-in-out;
}

button:hover {
	box-shadow: none;
}

button:active {
	box-shadow: 0 0 0 0.5vh white inset;
}

#addon {
	width: 40vh;
	margin: auto;
}

.logo {
	height: 14vh;
	width: 14vh;
	margin: auto;
	margin-bottom: 3vh;
}

.logo img {
	width: 100%;
}

.name, .version {
	display: inline-block;
	vertical-align: top;
}

.name {
	line-height: 5vh;
	margin: 0;
}

.version {
	position: relative;
	line-height: 5vh;
	opacity: 0.8;
	margin-bottom: 2vh;
}

.contact {
	position: absolute;
	left: 0;
	bottom: 4vh;
	width: 100%;
	text-align: center;
}

.contact a {
	font-size: 1.4vh;
	font-style: italic;
}

.separator {
	margin-bottom: 4vh;
}

.form-element {
	margin-bottom: 2vh;
}

.label-to-top {
	margin-bottom: 2vh;
}

.label-to-right {
	margin-left: 1vh !important;
}

.full-width {
	width: 100%;
}

/* Button container for multiple buttons */
.button-container {
	display: flex;
	gap: 1vh;
	flex-wrap: wrap;
	justify-content: center;
	margin-bottom: 2vh;
}

.button-container button {
	flex: 1;
	min-width: 10vh;
	padding: 1.2vh 2vh;
	font-size: 1.8vh;
}

/* Secondary button style */
button.secondary {
	background: #5a5a8a;
}

/* Copy success feedback */
button.copied {
	background: #4a8a5a !important;
}

/* Toast notification */
.toast {
	position: fixed;
	bottom: 3vh;
	left: 50%;
	transform: translateX(-50%);
	background: #4a8a5a;
	color: white;
	padding: 1.5vh 3vh;
	border-radius: 0.5vh;
	font-size: 1.8vh;
	opacity: 0;
	transition: opacity 0.3s ease-in-out;
	pointer-events: none;
	z-index: 1000;
}

.toast.show {
	opacity: 1;
}
`

function landingTemplate(manifest) {
	const background = manifest.background || 'https://dl.strem.io/addon-background.jpg'
	const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png'
	const contactHTML = manifest.contactEmail ?
		`<div class="contact">
			<p>Contact ${manifest.name} creator:</p>
			<a href="mailto:${manifest.contactEmail}">${manifest.contactEmail}</a>
		</div>` : ''

	const stylizedTypes = manifest.types
		.map(t => t[0].toUpperCase() + t.slice(1) + (t !== 'series' ? 's' : ''))

	let formHTML = ''
	let script = ''

	if ((manifest.config || []).length) {
		let options = ''
		manifest.config.forEach(elem => {
			const key = elem.key
			if (['text', 'number', 'password'].includes(elem.type)) {
				const isRequired = elem.required ? ' required' : ''
				const defaultHTML = elem.default ? ` value="${elem.default}"` : ''
				const inputType = elem.type
				options += `
				<div class="form-element">
					<div class="label-to-top">${elem.title}</div>
					<input type="${inputType}" id="${key}" name="${key}" class="full-width"${defaultHTML}${isRequired}/>
				</div>
				`
			} else if (elem.type === 'checkbox') {
				const isChecked = elem.default === 'checked' ? ' checked' : ''
				options += `
				<div class="form-element">
					<label for="${key}">
						<input type="checkbox" id="${key}" name="${key}"${isChecked}> <span class="label-to-right">${elem.title}</span>
					</label>
				</div>
				`
			} else if (elem.type === 'select') {
				const defaultValue = elem.default || (elem.options || [])[0]
				options += `<div class="form-element">
				<div class="label-to-top">${elem.title}</div>
				<select id="${key}" name="${key}" class="full-width">
				`
				const selections = elem.options || []
				selections.forEach(el => {
					const isSelected = el === defaultValue ? ' selected' : ''
					options += `<option value="${el}"${isSelected}>${el}</option>`
				})
				options += `</select>
               </div>
               `
			}
		})
		if (options.length) {
			formHTML = `
			<form class="pure-form" id="mainForm">
				${options}
			</form>

			<div class="separator"></div>
			`
			script += `
			const updateLink = () => {
				const config = Object.fromEntries(new FormData(mainForm))
				const configPath = '/' + encodeURIComponent(JSON.stringify(config))
				const manifestPath = configPath + '/manifest.json'

				// Update all links
				installLink.href = 'stremio://' + window.location.host + manifestPath
				webInstallLink.href = 'https://web.strem.io/#/addons?addon=' + encodeURIComponent(window.location.protocol + '//' + window.location.host + manifestPath)
				copyLinkBtn.dataset.url = window.location.protocol + '//' + window.location.host + manifestPath
			}
			mainForm.onchange = updateLink

			// Validate form before install
			installLink.onclick = () => {
				return mainForm.reportValidity()
			}
			webInstallLink.onclick = (e) => {
				if (!mainForm.reportValidity()) {
					e.preventDefault()
					return false
				}
			}
			`
		}
	}

	return `
	<!DOCTYPE html>
	<html style="background-image: url(${background});">

	<head>
		<meta charset="utf-8">
		<title>${manifest.name} - Stremio Addon</title>
		<style>${STYLESHEET}</style>
		<link rel="shortcut icon" href="${logo}" type="image/x-icon">
		<link href="https://fonts.googleapis.com/css?family=Open+Sans:400,600,700&display=swap" rel="stylesheet">
		<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/purecss@2.1.0/build/pure-min.css" integrity="sha384-yHIFVG6ClnONEA5yB5DJXfW2/KC173DIQrYoZMEtBvGzmf0PKiGyNEqe9N6BNDBH" crossorigin="anonymous">
	</head>

	<body>
		<div id="addon">
			<div class="logo">
			<img src="${logo}">
			</div>
			<h1 class="name">${manifest.name}</h1>
			<h2 class="version">v${manifest.version || '0.0.0'}</h2>
			<h2 class="description">${manifest.description || ''}</h2>

			<div class="separator"></div>

			<h3 class="gives">This addon has more :</h3>
			<ul>
			${stylizedTypes.map(t => `<li>${t}</li>`).join('')}
			</ul>

			<div class="separator"></div>

			${formHTML}

			<div class="button-container">
				<a id="installLink" class="install-link" href="#">
					<button name="Install">Install</button>
				</a>
				<a id="webInstallLink" class="install-link" href="#" target="_blank">
					<button name="InstallWeb" class="secondary">Install (Web)</button>
				</a>
				<button id="copyLinkBtn" class="secondary" data-url="#">Copy Link</button>
			</div>

			${contactHTML}
		</div>

		<div id="toast" class="toast">Link copied to clipboard!</div>

		<script>
			${script}

			// Copy link functionality
			copyLinkBtn.onclick = async () => {
				const url = copyLinkBtn.dataset.url
				try {
					await navigator.clipboard.writeText(url)

					// Show toast
					const toast = document.getElementById('toast')
					toast.classList.add('show')
					setTimeout(() => toast.classList.remove('show'), 2000)

					// Visual feedback on button
					const originalText = copyLinkBtn.textContent
					copyLinkBtn.textContent = 'Copied!'
					copyLinkBtn.classList.add('copied')
					setTimeout(() => {
						copyLinkBtn.textContent = originalText
						copyLinkBtn.classList.remove('copied')
					}, 2000)
				} catch (err) {
					// Fallback for older browsers
					const textArea = document.createElement('textarea')
					textArea.value = url
					textArea.style.position = 'fixed'
					textArea.style.left = '-9999px'
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

			// Initialize links
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

	</html>`
}

module.exports = landingTemplate
