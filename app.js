document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById("patchBtn");
    const statusEl = document.getElementById("status");
    const fileInput = document.getElementById("inputFile");
    const dropArea = document.getElementById("dropArea");
    const dropText = document.getElementById("dropText");
    const dropSub = document.getElementById("dropSub");

    // ---------- Drag & Drop ----------
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
        dropArea.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false));

    // შესწორება: ადრე კლასი ერთიანად ემატებოდა და მაშინვე იშლებოდა (ივენთების გარეშე)
    ['dragenter', 'dragover'].forEach(ev =>
        dropArea.addEventListener(ev, () => dropArea.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(ev =>
        dropArea.addEventListener(ev, () => dropArea.classList.remove('dragover')));

    dropArea.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            updateFileInfo(files[0]);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) updateFileInfo(fileInput.files[0]);
    });

    function updateFileInfo(file) {
        dropText.textContent = file.name;
        dropSub.textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";
    }

    // ---------- პატჩერის ბირთვის ძებნა ----------
    function findPatcher() {
        for (let key in window) {
            try {
                if (key.includes('ZilemPat')) {
                    let obj = window[key];
                    let versions = Object.keys(obj);
                    if (versions.length > 0 && obj[versions[0]].quickPatch) return obj[versions[0]];
                }
            } catch (e) {}
        }
        for (let key in window) {
            try {
                let obj = window[key];
                if (obj && typeof obj === 'object') {
                    for (let v in obj) { if (obj[v] && obj[v].quickPatch) return obj[v]; }
                }
            } catch (e) {}
        }
        return null;
    }

    function getTicketFromUrl() {
        return new URLSearchParams(window.location.search).get('ticket') || '';
    }

    // ---------- შედეგის უსაფრთხო ამოღება ----------
    // quickPatch-ის შედეგი შეიძლება იყოს Uint8Array / ArrayBuffer / Blob / chunk-ების მასივი.
    // ძველი შემოწმება (byteLength === 0) ვერ იჭერდა ცარიელ Blob-ს ან ცარიელ მასივს -> 0 MB ფაილი.
    function sizeOf(x) {
        if (!x) return 0;
        if (typeof x.byteLength === 'number') return x.byteLength;
        if (typeof x.size === 'number') return x.size;
        if (Array.isArray(x)) return x.reduce((s, c) => s + sizeOf(c), 0);
        return 0;
    }

    function pickOutput(res) {
        if (!res) return null;
        if (res instanceof Uint8Array || res instanceof ArrayBuffer || res instanceof Blob) return res;
        for (const k of ['out', 'output', 'data', 'buffer', 'result', 'bytes']) {
            if (res[k] && sizeOf(res[k]) > 0) return res[k];
        }
        return res.out || null;
    }

    function describe(res) {
        try {
            if (!res) return String(res);
            if (typeof res !== 'object') return typeof res;
            return Object.keys(res).map(k => {
                const v = res[k];
                return k + ':' + (v && v.constructor ? v.constructor.name : typeof v) + '(' + sizeOf(v) + ')';
            }).join(', ');
        } catch (e) { return '?'; }
    }

    async function hasMp4Signature(blob) {
        const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        return String.fromCharCode(...head.slice(4, 8)) === 'ftyp';
    }

    // ---------- მთავარი ----------
    btn.addEventListener("click", async () => {
        const file = fileInput.files[0];
        if (!file) return showStatus("გთხოვთ აირჩიოთ ან ჩააგდოთ MP4 ვიდეო!", "red");

        const ticket = getTicketFromUrl();
        if (!ticket) return showStatus("შეცდომა: წვდომის ბილეთი (ticket) ვერ მოიძებნა!", "red");

        btn.disabled = true;
        showStatus("მოწმდება ბილეთი სერვერზე...", "yellow");

        try {
            // 1. ბილეთის შემოწმება
            const formData = new FormData();
            formData.append('file', file);
            formData.append('ticket', ticket);

            const response = await fetch('https://patcheri12.onrender.com/api/optimize', {
                method: 'POST',
                body: formData
            });

            let serverResult = {};
            try { serverResult = await response.json(); } catch (e) {}
            console.log('[patcher] server response', response.status, serverResult);

            if (!response.ok || !serverResult.success) {
                throw new Error(serverResult.error || serverResult.message || ("სერვერმა უარყო მოთხოვნა (HTTP " + response.status + ")."));
            }

            showStatus("მიმდინარეობს ვიდეოს დაპატჩვა (არ დახუროთ გვერდი)...", "yellow");

            // 2. ფაილის წაკითხვა
            const arrayBuffer = await file.arrayBuffer();

            const patcher = findPatcher();
            if (!patcher) throw new Error("პატჩერის ბირთვი (core.js) ვერ მოიძებნა!");

            const fps = Number(serverResult.fps) > 0 ? Number(serverResult.fps) : 60;

            // 3. დაპატჩვა. quickPatch-მა შეიძლება შემავალი ბუფერი შეცვალოს/გამოიყენოს,
            // ამიტომ ყოველ ცდაზე ახალ ასლს ვაძლევთ. თუ ცარიელი გამოვიდა, ოფციებს ვამცირებთ.
            const attempts = [
                { useTmcd: true,  useAlt: true,  useDur: true  },
                { useTmcd: true,  useAlt: false, useDur: true  },
                { useTmcd: false, useAlt: false, useDur: true  },
                { useTmcd: false, useAlt: false, useDur: false }
            ];

            let blob = null, lastInfo = '';
            for (let i = 0; i < attempts.length; i++) {
                const videoBuffer = new Uint8Array(arrayBuffer.slice(0));

                const compatibility = patcher.checkCompatibility(new Uint8Array(arrayBuffer.slice(0)));
                if (compatibility && compatibility.compatible === false) {
                    throw new Error("ვიდეო არ არის თავსებადი: " + (compatibility.reason || ''));
                }

                let res;
                try {
                    res = patcher.quickPatch(videoBuffer, Object.assign({ fpsOverride: fps }, attempts[i]));
                    if (res && typeof res.then === 'function') res = await res; // თუ async არის
                } catch (e) {
                    lastInfo = 'exception: ' + e.message;
                    console.warn('[patcher] attempt', i, lastInfo);
                    continue;
                }

                lastInfo = describe(res);
                console.log('[patcher] attempt', i, attempts[i], lastInfo);

                const out = pickOutput(res);
                if (!out || sizeOf(out) === 0) continue;

                const b = new Blob([out], { type: "video/mp4" });
                if (b.size === 0) continue;
                if (!(await hasMp4Signature(b))) { lastInfo += ' | არასწორი MP4 სათაური'; continue; }

                blob = b;
                if (i > 0) console.warn('[patcher] წარმატებული ცდა N' + (i + 1) + ' შემცირებული ოფციებით', attempts[i]);
                break;
            }

            if (!blob) {
                throw new Error("პატჩერმა ცარიელი ფაილი დააბრუნა. პატჩერის პასუხი: " + lastInfo);
            }

            // 4. ჩამოტვირთვა
            const mbSize = (blob.size / (1024 * 1024)).toFixed(2);
            showStatus(`ვიდეო დაპატჩულია! ზომა: ${mbSize} MB. იწყება ჩამოტვირთვა...`, "green");

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = "patched_" + file.name;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 60000);

        } catch (err) {
            console.error(err);
            showStatus("შეცდომა: " + err.message, "red");
        } finally {
            btn.disabled = false;
        }
    });

    function showStatus(msg, color) {
        statusEl.style.display = "block";
        statusEl.textContent = msg;
        statusEl.style.color = color === "red" ? "var(--error)" : color === "green" ? "var(--success)" : "var(--flare-2)";
    }
});
