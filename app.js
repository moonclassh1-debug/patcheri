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

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.classList.add('dragover');
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.classList.remove('dragover');
    });

    dropArea.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            fileInput.files = files;
            updateFileInfo(files[0]);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            updateFileInfo(fileInput.files[0]);
        }
    });

    function updateFileInfo(file) {
        dropText.textContent = file.name;
        dropSub.textContent = (file.size / (1024 * 1024)).toFixed(2) + " MB";
    }

    // პატჩერის დინამიური მძებნელი (core.js-ის ობიექტის მოსაძებნად)
    function findPatcher() {
        for (let key in window) {
            try {
                if (key.includes('ZilemPat')) {
                    let obj = window[key];
                    let versions = Object.keys(obj);
                    if (versions.length > 0 && obj[versions[0]].quickPatch) {
                        return obj[versions[0]];
                    }
                }
            } catch(e) {}
        }
        for (let key in window) {
            try {
                let obj = window[key];
                if (obj && typeof obj === 'object') {
                    for (let v in obj) {
                        if (obj[v] && obj[v].quickPatch) return obj[v];
                    }
                }
            } catch(e) {}
        }
        return null;
    }

    // URL-იდან ბილეთის (ticket) ამოღების ფუნქცია
    function getTicketFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('ticket') || '';
    }

    // დაპატჩვის ღილაკზე დაჭერა
    btn.addEventListener("click", async () => {
        const file = fileInput.files[0];

        if (!file) {
            showStatus("გთხოვთ აირჩიოთ ან ჩააგდოთ MP4 ვიდეო!", "red");
            return;
        }

        const ticket = getTicketFromUrl();
        if (!ticket) {
            showStatus("შეცდომა: წვდომის ბილეთი (ticket) ვერ მოიძებნა URL-ში!", "red");
            return;
        }

        showStatus("მოწმდება ბილეთი სერვერზე...", "yellow");

        try {
            // 1. ბილეთისა და ვიდეოს გაგზავნა Render სერვერზე
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

            // 2. წარმატებული ავტორიზაციის შემდეგ გადავდივართ core.js-ით დაპატჩვაზე
            showStatus("ბილეთი დადასტურებულია! მიმდინარეობს ვიდეოს დაპატჩვა...", "green");

            const arrayBuffer = await file.arrayBuffer();
            const videoBuffer = new Uint8Array(arrayBuffer);

            const patcher = findPatcher();
            if (!patcher) {
                throw new Error("პატჩერის ბირთვი (core.js) ვერ ჩაიტვირთა!");
            }

            const compatibility = patcher.checkCompatibility(videoBuffer);
            if (!compatibility.compatible) {
                throw new Error("ვიდეო არ არის თავსებადი: " + compatibility.reason);
            }

            const patchedResult = await patcher.quickPatch(videoBuffer, {
                useTmcd: true,
                useAlt: true,
                useDur: true,
                fpsOverride: serverResult.fps || 60
            });

            let finalBuffer = null;
            if (patchedResult instanceof Uint8Array) {
                finalBuffer = patchedResult;
            } else if (patchedResult) {
                finalBuffer = patchedResult.out || patchedResult.buffer || patchedResult.data || patchedResult.result;
            }

            // 3. ლოკალურად გადმოწერა ბრაუზერში (0 მბ პრობლემის გამოსწორება)
            if (finalBuffer) {
                showStatus("ვიდეო წარმატებით დაპატჩდა! იწყება გადმოწერა...", "green");

                const blob = new Blob([finalBuffer], { type: "video/mp4" });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = "patched_" + file.name; // ინარჩუნებს ორიგინალ სახელს "patched_"-ის დამატებით
                
                document.body.appendChild(a);
                a.click();
                
                // მეხსიერების გაწმენდა 10 წამში
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 10000);
            } else {
                throw new Error("პატჩინგმა შედეგი არ დააბრუნა.");
            }
        } catch (err) {
            console.error(err);
            showStatus("შეცდომა: " + err.message, "red");
        }
    });

    function showStatus(msg, color) {
        statusEl.style.display = "block";
        statusEl.textContent = msg;
        statusEl.style.color = color === "red" ? "var(--error)" : color === "green" ? "var(--success)" : "var(--flare-2)";
    }
});
