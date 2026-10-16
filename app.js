document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById("patchBtn");
    const statusEl = document.getElementById("status");
    const fileInput = document.getElementById("inputFile");
    const dropArea = document.getElementById("dropArea");
    const dropText = document.getElementById("dropText");
    const dropSub = document.getElementById("dropSub");

    // Drag & Drop მოვლენების დამუშავება
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { 
        e.preventDefault(); 
        e.stopPropagation(); 
    }

    ['dragenter', 'dragover'].forEach(eventName => dropArea.classList.add('dragover'));
    ['dragleave', 'drop'].forEach(eventName => dropArea.classList.remove('dragover'));

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

    // პატჩერის ბირთვის დინამიური ძებნა
    function findPatcher() {
        for (let key in window) {
            try {
                if (key.includes('ZilemPat')) {
                    let obj = window[key];
                    let versions = Object.keys(obj);
                    if (versions.length > 0 && obj[versions[0]].quickPatch) return obj[versions[0]];
                }
            } catch(e) {}
        }
        for (let key in window) {
            try {
                let obj = window[key];
                if (obj && typeof obj === 'object') {
                    for (let v in obj) { if (obj[v] && obj[v].quickPatch) return obj[v]; }
                }
            } catch(e) {}
        }
        return null;
    }

    // URL-დან Ticket-ის წამოღება
    function getTicketFromUrl() {
        return new URLSearchParams(window.location.search).get('ticket') || '';
    }

    btn.addEventListener("click", async () => {
        const file = fileInput.files[0];
        if (!file) return showStatus("გთხოვთ აირჩიოთ ან ჩააგდოთ MP4 ვიდეო!", "red");

        const ticket = getTicketFromUrl();
        if (!ticket) return showStatus("შეცდომა: წვდომის ბილეთი (ticket) ვერ მოიძებნა!", "red");

        showStatus("მოწმდება ბილეთი სერვერზე...", "yellow");

        try {
            // 1. ბილეთის შემოწმება Render-ზე
            const formData = new FormData();
            formData.append('file', file);
            formData.append('ticket', ticket);

            const response = await fetch('https://patcheri12.onrender.com/api/optimize', {
                method: 'POST',
                body: formData
            });

            const serverResult = await response.json();
            if (!response.ok || !serverResult.success) {
                throw new Error(serverResult.error || "სერვერმა უარყო მოთხოვნა.");
            }

            showStatus("მიმდინარეობს ვიდეოს დაპატჩვა (არ დახუროთ გვერდი)...", "yellow");

            // 2. ფაილის მომზადება
            const arrayBuffer = await file.arrayBuffer();
            const videoBuffer = new Uint8Array(arrayBuffer);

            const patcher = findPatcher();
            if (!patcher) throw new Error("პატჩერის ბირთვი (core.js) ვერ მოიძებნა!");

            const compatibility = patcher.checkCompatibility(videoBuffer);
            if (!compatibility.compatible) {
                throw new Error("ვიდეო არ არის თავსებადი: " + compatibility.reason);
            }

            // 3. ვიდეოს დაპატჩვა
            const patchedResult = patcher.quickPatch(videoBuffer, {
                useTmcd: true,
                useAlt: true,
                useDur: true,
                fpsOverride: serverResult.fps || 60
            });

            // 4. დაპატჩული ფაილის ამოღება .out ობიექტიდან
            const finalBuffer = (patchedResult && patchedResult.out) ? patchedResult.out : null;

            if (!finalBuffer || finalBuffer.byteLength === 0) {
                throw new Error("პატჩერმა 0 მბ ფაილი დააბრუნა. შესაძლოა ვიდეო დაზიანებულია.");
            }

            // 5. ლოკალური ჩამოტვირთვა პირდაპირ ბრაუზერიდან
            const blob = new Blob([finalBuffer], { type: "video/mp4" });
            const mbSize = (blob.size / (1024 * 1024)).toFixed(2);
            
            showStatus(`ვიდეო დაპატჩულია! ზომა: ${mbSize} MB. იწყება ჩამოტვირთვა...`, "green");

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = "patched_" + file.name;
            document.body.appendChild(a);
            
            a.click(); // ვიდეოს გადმოწერის დაწყება

            // მეხსიერების გასუფთავება
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 10000);

        } catch (err) {
            console.error(err);
            showStatus("შეცდომა: " + err.message, "red");
        }
    });

    // შეტყობინებების ეკრანზე გამოტანის ფუნქცია
    function showStatus(msg, color) {
        statusEl.style.display = "block";
        statusEl.textContent = msg;
        statusEl.style.color = color === "red" ? "var(--error)" : color === "green" ? "var(--success)" : "var(--flare-2)";
    }
});
