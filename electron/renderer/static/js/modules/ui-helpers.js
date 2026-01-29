// Clara - UI Helpers Module
// Loading indicators, toasts, and utility functions

export class UIHelpers {
    constructor(clara) {
        this.clara = clara;
    }

    showLoading(msg = 'Loading...') {
        document.getElementById('loading-msg').textContent = msg;
        document.getElementById('loading').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
    }

    showInlineLoading(msg = 'Loading...') {
        this.hideInlineLoading();

        const indicator = document.createElement('div');
        indicator.id = 'inline-loading';
        indicator.className = 'loading-inline';
        indicator.innerHTML = `
            <div class="spinner"></div>
            <span>${msg}</span>
        `;
        document.body.appendChild(indicator);
    }

    hideInlineLoading() {
        const existing = document.getElementById('inline-loading');
        if (existing) {
            existing.remove();
        }
    }

    showToast(msg, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.className = 'toast show' + (isError ? ' error' : '');
        setTimeout(() => toast.classList.remove('show'), 4000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}