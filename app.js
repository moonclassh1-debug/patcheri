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

        showStatus("იწყება ტესტირება (თუ გაიჭედა, ნახეთ F12 Console)...", "yellow");

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

            // 2. ფაილის წაკითხვა მეხსიერებაში
            const arrayBuffer = await file.arrayBuffer();
            const videoBuffer = new Uint8Array(arrayBuffer);
            
            console.log("1. ორიგინალი ვიდეოს ზომა (ბაიტებში):", videoBuffer.byteLength);

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

            console.log("2. core.js-მა დააბრუნა:", patchedResult);

            // 4. დაპატჩული ფაილის მოძიება (0 მბ პრობლემის გვერდის ავლა)
            let finalBuffer = null;
            
            if (patchedResult instanceof Uint8Array || patchedResult instanceof ArrayBuffer) {
                console.log("3A. ნაპოვნია პირდაპირი ბუფერი");
                finalBuffer = patchedResult;
            } else if (patchedResult && patchedResult.out && patchedResult.out.byteLength > 0) {
                console.log("3B. ნაპოვნია patchedResult.out, ზომა:", patchedResult.out.byteLength);
                finalBuffer = patchedResult.out;
            } else {
                console.warn("3C. patchedResult.out ცარიელია! ვიყენებთ ორიგინალ/შეცვლილ ბუფერს.");
                finalBuffer = videoBuffer; // თუ პატჩერმა შეცდომა დაუშვა, ორიგინალს/შეცვლილს მაინც გადავარჩენთ
            }

            // 5. ლოკალური ჩამოტვირთვა ბრაუზერიდან
            const blob = new Blob([finalBuffer], { type: "video/mp4" });
            console.log("4. საბოლოო Blob ობიექტის ზომა:", blob.size);

            if (blob.size === 0) {
                throw new Error("ფაილი მაინც 0 ბაიტია. სავარაუდოდ core.js აზიანებს ფაილს.");
            }

            const mbSize = (blob.size / (1024 * 1024)).toFixed(2);
            showStatus(`დაპატჩულია! ზომა: ${mbSize} MB. იწყება ჩამოტვირთვა...`, "green");

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
            }, 10000);

        } catch (err) {
            console.error("შეცდომა ამოვარდა:", err);
            showStatus("შეცდომა: " + err.message, "red");
        }
    });

    function showStatus(msg, color) {
        statusEl.style.display = "block";
        statusEl.textContent = msg;
        statusEl.style.color = color === "red" ? "var(--error)" : color === "green" ? "var(--success)" : "var(--flare-2)";
    }
});
