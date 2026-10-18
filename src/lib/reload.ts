/** Reloads the page (a seam so tests need not stub window.location). */
export const reloadPage = () => window.location.reload();

/** Sends the browser to the login page without keeping this one in history (a seam like reloadPage). */
export const goToLogin = () => window.location.replace("/login");
