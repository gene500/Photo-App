use std::path::{Path, PathBuf};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const APP_URL: &str = "https://photo-app-pi2o.vercel.app/trips";
const APP_HOST: &str = "photo-app-pi2o.vercel.app";

/// True only for https URLs on exactly the app's own host: default port only
/// (no explicit port), no user name or password, and no trailing-dot host.
/// The URL parser already lowercases the host, so an uppercase host is the same host.
fn is_app_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(APP_HOST)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

/// A download started by the app itself: an app URL, or a `blob:` URL created by an app page
/// (its inner URL must be an app URL).
fn is_app_download_url(url: &Url) -> bool {
    if url.scheme() == "blob" {
        return Url::parse(url.path()).map(|inner| is_app_url(&inner)).unwrap_or(false);
    }
    is_app_url(url)
}

const MAX_NAME_BYTES: usize = 150;

/// Unicode format (Cf) and bidi characters that can spoof a file extension
/// (e.g. U+202E right-to-left override).
fn is_format_char(c: char) -> bool {
    matches!(c,
        '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}

/// Windows reserved device names. `stem` is the part before the first dot.
/// Trailing spaces and dots are ignored because Windows ignores them ("CON .txt").
fn is_windows_device_name(stem: &str) -> bool {
    let up = stem.trim_end_matches(|c: char| c == '.' || c.is_whitespace()).to_uppercase();
    if matches!(up.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return true;
    }
    let mut chars = up.chars();
    let prefix: String = chars.by_ref().take(3).collect();
    matches!(prefix.as_str(), "COM" | "LPT")
        && matches!(chars.next(), Some('0'..='9' | '\u{b9}' | '\u{b2}' | '\u{b3}'))
        && chars.next().is_none()
}

/// Reduce a suggested file name to a safe bare file name (no path components,
/// no control, format/bidi or reserved characters, never empty, not a Windows
/// device name, at most `MAX_NAME_BYTES` bytes with the extension preserved).
fn sanitize_file_name(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| {
            !c.is_control()
                && !is_format_char(*c)
                && !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
        .collect();
    let mut name = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace()).to_string();
    if name.len() > MAX_NAME_BYTES {
        // Truncate the stem, not the extension, so the file type does not change.
        // A very long "extension" is not treated as one.
        let (stem, ext) = match name.rfind('.') {
            Some(i) if i > 0 && name.len() - i <= 32 => (&name[..i], &name[i..]),
            _ => (name.as_str(), ""),
        };
        let mut cut = MAX_NAME_BYTES - ext.len();
        while !stem.is_char_boundary(cut) {
            cut -= 1;
        }
        name = format!("{}{}", &stem[..cut], ext);
    }
    let name = name.trim_end_matches(|c: char| c == '.' || c.is_whitespace()).to_string();
    if name.is_empty() {
        return "download".to_string();
    }
    if is_windows_device_name(name.split('.').next().unwrap_or("")) {
        return format!("_{name}");
    }
    name
}

/// True if anything at all exists at `p`, including a dangling symlink
/// (`Path::exists` follows symlinks and would call a dangling one free).
/// A true race cannot be closed here because the webview engine writes the file
/// after we return the destination.
fn path_taken(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

/// `dir/name`, or `dir/stem (1).ext`, `(2)`, ... until `exists` says the path is free.
fn unique_path(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 1u32;
    loop {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !exists(&candidate) || n == u32::MAX {
            return candidate;
        }
        n += 1;
    }
}

/// Only hand web and mail links to the OS; never file:, custom schemes, etc.
fn open_externally<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let nav_handle = app.handle().clone();
            let new_win_handle = app.handle().clone();
            let url: Url = APP_URL.parse().expect("valid app url");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Photo Op Planner")
                .inner_size(1280.0, 860.0)
                .on_navigation(move |url| {
                    if is_app_url(url) {
                        return true;
                    }
                    open_externally(&nav_handle, url);
                    false
                })
                .on_new_window(move |url, _features| {
                    if is_app_url(&url) {
                        // Keep in-app links in the same window rather than spawning one.
                        if let Some(w) = new_win_handle.get_webview_window("main") {
                            let _ = w.navigate(url);
                        }
                        return NewWindowResponse::Deny;
                    }
                    open_externally(&new_win_handle, &url);
                    NewWindowResponse::Deny
                })
                .on_download(|webview, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            if !is_app_download_url(&url) {
                                return false;
                            }
                            let Ok(dir) = webview.path().download_dir() else {
                                return false;
                            };
                            let suggested = destination
                                .file_name()
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_default();
                            let name = sanitize_file_name(&suggested);
                            *destination = unique_path(&dir, &name, path_taken);
                            true
                        }
                        DownloadEvent::Finished { .. } => true,
                        // DownloadEvent is non-exhaustive: any future variant is denied
                        // until it is handled here on purpose.
                        _ => false,
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Photo Op Planner");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(s: &str) -> bool {
        is_app_url(&Url::parse(s).unwrap())
    }

    #[test]
    fn allows_app_origin() {
        assert!(check("https://photo-app-pi2o.vercel.app/trips"));
        assert!(check("https://photo-app-pi2o.vercel.app/"));
    }

    #[test]
    fn rejects_everything_else() {
        assert!(!check("http://photo-app-pi2o.vercel.app/trips"));
        assert!(!check("https://photo-app-pi2o.vercel.app.evil.com/"));
        assert!(!check("https://evil.com/?u=https://photo-app-pi2o.vercel.app"));
        assert!(!check("https://user@evil.com/"));
        assert!(!check("mailto:a@b.c"));
    }

    #[test]
    fn rejects_non_default_port() {
        assert!(!check("https://photo-app-pi2o.vercel.app:8443/"));
        assert!(check("https://photo-app-pi2o.vercel.app:443/")); // default port is dropped by the parser
    }

    #[test]
    fn rejects_userinfo_trick() {
        assert!(!check("https://photo-app-pi2o.vercel.app@evil.com/"));
        assert!(!check("https://photo-app-pi2o.vercel.app:pw@evil.com/"));
        assert!(!check("https://user@photo-app-pi2o.vercel.app/"));
        assert!(!check("https://user:pw@photo-app-pi2o.vercel.app/"));
    }

    #[test]
    fn rejects_lookalike_hosts() {
        assert!(!check("https://evil-photo-app-pi2o.vercel.app/"));
        assert!(!check("https://photo-app-pi2o.vercel.app.evil.com/"));
        assert!(!check("https://sub.photo-app-pi2o.vercel.app/"));
        assert!(!check("https://photo-app-pi2o.vercel.apps/"));
        assert!(!check("https://vercel.app/"));
    }

    #[test]
    fn host_case_and_trailing_dot() {
        assert!(check("https://PHOTO-APP-PI2O.VERCEL.APP/trips"));
        assert!(!check("https://photo-app-pi2o.vercel.app./trips"));
    }

    #[test]
    fn download_origin() {
        let d = |s: &str| is_app_download_url(&Url::parse(s).unwrap());
        assert!(d("https://photo-app-pi2o.vercel.app/api/export"));
        assert!(d("blob:https://photo-app-pi2o.vercel.app/3f1c2a9e-0000-4000-8000-000000000000"));
        assert!(!d("blob:https://evil.com/3f1c2a9e-0000-4000-8000-000000000000"));
        assert!(!d("https://evil.com/a.pdf"));
        assert!(!d("data:text/plain,hi"));
        assert!(!d("file:///etc/passwd"));
    }

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(sanitize_file_name("trip.pdf"), "trip.pdf");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("C:\\Users\\x\\evil.ics"), "evil.ics");
        assert_eq!(sanitize_file_name("a/b\\c.pdf"), "c.pdf");
        assert_eq!(sanitize_file_name("we<ir>d:\"na|me?*.pdf"), "weirdname.pdf");
        assert_eq!(sanitize_file_name("tab\there\n.ics"), "tabhere.ics");
        assert_eq!(sanitize_file_name(""), "download");
        assert_eq!(sanitize_file_name("..."), "download");
        assert_eq!(sanitize_file_name("dir/"), "download");
        assert_eq!(sanitize_file_name(".hidden"), "hidden");
        assert_eq!(sanitize_file_name("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_file_name("lpt1"), "_lpt1");
        assert_eq!(sanitize_file_name("Trip Plan (1).pdf"), "Trip Plan (1).pdf");
        assert!(sanitize_file_name(&"a".repeat(400)).len() <= MAX_NAME_BYTES);
    }

    #[test]
    fn unique_names_never_overwrite() {
        let dir = Path::new("/d");
        let taken = |names: &'static [&'static str]| {
            move |p: &Path| names.iter().any(|n| p == dir.join(n))
        };
        assert_eq!(unique_path(dir, "a.pdf", taken(&[])), dir.join("a.pdf"));
        assert_eq!(unique_path(dir, "a.pdf", taken(&["a.pdf"])), dir.join("a (1).pdf"));
        assert_eq!(
            unique_path(dir, "a.pdf", taken(&["a.pdf", "a (1).pdf", "a (2).pdf"])),
            dir.join("a (3).pdf")
        );
        assert_eq!(unique_path(dir, "noext", taken(&["noext"])), dir.join("noext (1)"));
        assert_eq!(unique_path(dir, "x.tar.gz", taken(&["x.tar.gz"])), dir.join("x.tar (1).gz"));
    }

    #[test]
    fn device_names_with_trailing_space_and_superscripts() {
        assert_eq!(sanitize_file_name("CON .txt"), "_CON .txt");
        assert_eq!(sanitize_file_name("NUL .txt"), "_NUL .txt");
        assert_eq!(sanitize_file_name("COM\u{b9}.txt"), "_COM\u{b9}.txt");
        assert_eq!(sanitize_file_name("lpt\u{b2}"), "_lpt\u{b2}");
        assert_eq!(sanitize_file_name("COM\u{b3}.x"), "_COM\u{b3}.x");
        assert_eq!(sanitize_file_name("CONIN$"), "_CONIN$");
        assert_eq!(sanitize_file_name("conout$.log"), "_conout$.log");
        assert_eq!(sanitize_file_name("COM10.txt"), "COM10.txt");
    }

    #[test]
    fn strips_bidi_and_format_chars() {
        assert_eq!(sanitize_file_name("evil\u{202E}fdp.exe"), "evilfdp.exe");
        for c in ['\u{200B}', '\u{200F}', '\u{202A}', '\u{2060}', '\u{2064}', '\u{2066}', '\u{2069}', '\u{FEFF}'] {
            assert_eq!(sanitize_file_name(&format!("a{c}b.pdf")), "ab.pdf");
        }
    }

    #[test]
    fn length_cap_keeps_extension() {
        let n = sanitize_file_name(&format!("{}.pdf", "a".repeat(400)));
        assert!(n.len() <= MAX_NAME_BYTES);
        assert!(n.ends_with(".pdf"));
        let n = sanitize_file_name(&format!("{}.pdf", "\u{e9}".repeat(200)));
        assert!(n.len() <= MAX_NAME_BYTES);
        assert!(n.ends_with(".pdf"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_target_counts_as_taken() {
        let dir = std::env::temp_dir().join(format!("photoop-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::os::unix::fs::symlink("/nonexistent/target", dir.join("a.pdf")).unwrap();
        assert!(!dir.join("a.pdf").exists()); // dangling: exists() says free
        assert!(path_taken(&dir.join("a.pdf")));
        assert!(!path_taken(&dir.join("b.pdf")));
        assert_eq!(unique_path(&dir, "a.pdf", path_taken), dir.join("a (1).pdf"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
