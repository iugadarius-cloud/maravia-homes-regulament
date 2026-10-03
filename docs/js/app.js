const HOST_EMAIL = "iugaica@yahoo.com";

const state = {
  config: null,
  apartmentId: null,
  drawing: false,
  fonts: null,
};

const $ = (sel) => document.querySelector(sel);
const step = (name) => {
  document.querySelectorAll("[data-step]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.step !== name);
  });
};

function setupPad() {
  const canvas = $("#pad");
  const ctx = canvas.getContext("2d");
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const cssW = canvas.clientWidth || 700;
  const cssH = 180;
  canvas.width = Math.floor(cssW * ratio);
  canvas.height = Math.floor(cssH * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#2b2118";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };

  const start = (e) => {
    e.preventDefault();
    state.drawing = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!state.drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => {
    state.drawing = false;
  };

  canvas.onmousedown = start;
  canvas.onmousemove = move;
  window.addEventListener("mouseup", end);
  canvas.ontouchstart = start;
  canvas.ontouchmove = move;
  canvas.ontouchend = end;

  $("#clearPad").onclick = () => {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);
  };
}

function isBlankCanvas() {
  const canvas = $("#pad");
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
  }
  return true;
}

function renderApartments() {
  const box = $("#apartments");
  box.innerHTML = state.config.apartments
    .map(
      (a) => `
      <button type="button" class="apt" data-id="${a.id}">
        <h3>${a.name}</h3>
      </button>`
    )
    .join("");
  box.querySelectorAll(".apt").forEach((btn) => {
    btn.onclick = () => openForm(btn.dataset.id);
  });
}

function renderRules() {
  $("#rules").innerHTML = state.config.rules
    .map(
      (s) => `
      <h3>${s.title}</h3>
      <ul>${s.items.map((i) => `<li>${i}</li>`).join("")}</ul>`
    )
    .join("");
}

function openForm(id) {
  state.apartmentId = id;
  const apt = state.config.apartments.find((a) => a.id === id);
  $("#aptLabel").textContent = apt.name;
  step("form");
  requestAnimationFrame(setupPad);
}

function wrapText(font, text, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildPdf(guest, apartment, signedAt) {
  const { PDFDocument, rgb } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (!state.fonts) {
    const [reg, bold] = await Promise.all([
      fetch("fonts/NotoSans-Regular.ttf").then((r) => r.arrayBuffer()),
      fetch("fonts/NotoSans-Bold.ttf").then((r) => r.arrayBuffer()),
    ]);
    state.fonts = { reg, bold };
  }
  const font = await pdf.embedFont(state.fonts.reg, { subset: true });
  const fontBold = await pdf.embedFont(state.fonts.bold, { subset: true });
  const ink = rgb(0.17, 0.13, 0.1);
  const muted = rgb(0.42, 0.34, 0.28);

  let page = pdf.addPage([595.28, 841.89]);
  const margin = 50;
  const maxW = 595.28 - margin * 2;
  let y = 800;

  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 800;
  };
  const need = (h) => {
    if (y - h < 50) newPage();
  };
  const draw = (text, { bold = false, size = 10, color = ink, gap = 14 } = {}) => {
    const f = bold ? fontBold : font;
    const lines = wrapText(f, text, size, maxW);
    for (const line of lines) {
      need(size + 4);
      page.drawText(line, { x: margin, y, size, font: f, color });
      y -= size + 3;
    }
    y -= gap - 3;
  };

  pdf.setTitle("Acord regulament — " + apartment.name);
  pdf.setAuthor(state.config.hostName);

  draw(state.config.hostName, { bold: true, size: 16, gap: 8 });
  draw("ACORD DE RESPECTARE A REGULAMENTULUI", { bold: true, size: 13, gap: 6 });
  draw(apartment.name, { size: 10, color: muted, gap: 18 });

  draw("Datele oaspetelui", { bold: true, size: 12, gap: 8 });
  const rows = [
    ["Nume și prenume", guest.fullName],
    ["CNP", guest.cnp],
    ["Serie CI", guest.serieCi],
    ["Telefon", guest.phone],
    ["E-mail", guest.email || "—"],
    ["Check-in", guest.checkIn],
    ["Check-out", guest.checkOut],
    ["Număr persoane", String(guest.guests)],
    ["Data semnării", signedAt],
  ];
  for (const [k, v] of rows) {
    draw(k + ": " + v, { size: 10, gap: 4 });
  }
  y -= 10;
  draw("Regulament", { bold: true, size: 12, gap: 10 });
  state.config.rules.forEach((section, i) => {
    draw(`${i + 1}. ${section.title}`, { bold: true, size: 11, gap: 6 });
    section.items.forEach((item) => {
      draw("•  " + item, { size: 9, color: ink, gap: 5 });
    });
    y -= 6;
  });

  draw(
    "Prin semnătura de mai jos, confirm că am citit regulamentul, îl înțeleg și mă angajez să îl respect pe toată durata șederii, împreună cu persoanele care mă însoțesc. Cunosc faptul că nerespectarea regulilor poate duce la încetarea sejurului fără rambursare și la plata daunelor.",
    { size: 9, gap: 16 }
  );
  draw("Semnătura oaspetelui", { bold: true, size: 11, gap: 8 });

  const src = $("#pad");
  const mini = document.createElement("canvas");
  mini.width = 420;
  mini.height = 130;
  const mctx = mini.getContext("2d");
  mctx.fillStyle = "#ffffff";
  mctx.fillRect(0, 0, mini.width, mini.height);
  mctx.drawImage(src, 0, 0, mini.width, mini.height);
  const pngBytes = await fetch(mini.toDataURL("image/png")).then((r) => r.arrayBuffer());
  const img = await pdf.embedPng(pngBytes);
  need(90);
  const imgH = 70;
  const imgW = (img.width / img.height) * imgH;
  page.drawRectangle({
    x: margin,
    y: y - imgH - 6,
    width: Math.min(imgW, 240) + 8,
    height: imgH + 12,
    borderColor: rgb(0.77, 0.7, 0.64),
    borderWidth: 0.8,
  });
  page.drawImage(img, {
    x: margin + 4,
    y: y - imgH,
    width: Math.min(imgW, 240),
    height: imgH,
  });
  y -= imgH + 22;
  draw(`${guest.fullName}  ·  ${signedAt}  ·  ${apartment.name}`, {
    size: 8,
    color: muted,
    gap: 0,
  });

  const bytes = await pdf.save({ useObjectStreams: true });
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return "data:application/pdf;base64," + btoa(binary);
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",", 2);
  const mime = (header.match(/data:([^;]+)/) || [])[1] || "application/pdf";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function pdfFileFromDataUrl(dataUrl, fileName) {
  const blob = dataUrlToBlob(dataUrl);
  try {
    return new File([blob], fileName, { type: "application/pdf" });
  } catch (e) {
    return blob;
  }
}

function sendPdfByMultipartForm(fields, pdfFile) {
  return new Promise((resolve, reject) => {
    const fileName = pdfFile.name || "acord.pdf";
    let fileToSend = pdfFile;
    if (!(pdfFile instanceof File)) {
      try {
        fileToSend = new File([pdfFile], fileName, { type: "application/pdf" });
      } catch (e) {
        reject(new Error("Browserul nu poate atașa PDF-ul."));
        return;
      }
    }
    if (!window.DataTransfer) {
      reject(new Error("Folosiți Chrome sau Safari ca să se trimită PDF-ul."));
      return;
    }
    const iframe = document.createElement("iframe");
    iframe.name = "mailpdf_" + Date.now();
    iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden");
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://formsubmit.co/" + HOST_EMAIL;
    form.enctype = "multipart/form-data";
    form.acceptCharset = "UTF-8";
    form.target = iframe.name;
    Object.keys(fields).forEach((key) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = String(fields[key]);
      form.appendChild(input);
    });
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.name = "file";
    fileInput.setAttribute("accept", "application/pdf");
    const dt = new DataTransfer();
    dt.items.add(fileToSend);
    fileInput.files = dt.files;
    if (!fileInput.files || !fileInput.files.length) {
      reject(new Error("PDF-ul nu a putut fi pus în formular."));
      return;
    }
    form.appendChild(fileInput);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    const cleanup = () => {
      form.remove();
      iframe.remove();
    };
    const done = () => {
      cleanup();
      resolve();
    };
    iframe.addEventListener("load", done, { once: true });
    form.submit();
    setTimeout(done, 4500);
  });
}

async function sendViaFormSubmit(guest, apartment, pdfDataUrl) {
  const fileName =
    "Acord-" +
    apartment.id +
    "-" +
    String(guest.fullName).replace(/[^a-zA-Z0-9_-]+/g, "-") +
    ".pdf";
  const fields = {
    Apartament: apartment.name,
    Nume: guest.fullName,
    CNP: guest.cnp,
    "Serie CI": guest.serieCi,
    Telefon: guest.phone,
    "Email oaspete": guest.email || "—",
    "Check-in": guest.checkIn,
    "Check-out": guest.checkOut,
    Persoane: String(guest.guests),
    Atasament: "Da — fișier PDF semnat",
    _subject: "Acord PDF semnat — " + apartment.name + " — " + guest.fullName,
    _captcha: "false",
    _template: "box",
  };
  await sendPdfByMultipartForm(fields, pdfFileFromDataUrl(pdfDataUrl, fileName));
}

async function boot() {
  const res = await fetch("config.json?v=12");
  state.config = await res.json();
  $("#hostName").textContent = state.config.hostName;
  document.title = state.config.hostName;
  renderApartments();
  renderRules();
}

$("#backPick").onclick = () => step("pick");
$("#another").onclick = () => {
  $("#guestForm").reset();
  step("pick");
};

const cnpInput = document.querySelector('input[name="cnp"]');
const serieInput = document.querySelector('input[name="serieCi"]');
cnpInput.addEventListener("input", () => {
  cnpInput.value = cnpInput.value.replace(/\D/g, "").slice(0, 13);
});
serieInput.addEventListener("input", () => {
  serieInput.value = serieInput.value.replace(/\s/g, "").toUpperCase().slice(0, 8);
});

$("#guestForm").onsubmit = async (e) => {
  e.preventDefault();
  const err = $("#formError");
  err.classList.add("hidden");
  const fd = new FormData(e.target);
  const guest = Object.fromEntries(fd.entries());
  guest.accepted = fd.get("accepted") === "on";
  guest.guests = Number(guest.guests);
  guest.cnp = String(guest.cnp || "").replace(/\s/g, "");
  guest.serieCi = String(guest.serieCi || "")
    .replace(/\s/g, "")
    .toUpperCase();

  if (!guest.fullName || guest.fullName.trim().length < 3) {
    err.textContent = "Introduceți numele complet.";
    err.classList.remove("hidden");
    return;
  }
  if (!/^\d{13}$/.test(guest.cnp)) {
    err.textContent = "CNP-ul trebuie să aibă exact 13 cifre.";
    err.classList.remove("hidden");
    return;
  }
  if (!/^[A-Z]{2}\d{6}$/.test(guest.serieCi)) {
    err.textContent = "Seria CI trebuie să aibă 2 litere și 6 cifre (ex. RK123456).";
    err.classList.remove("hidden");
    return;
  }
  if (!guest.phone || guest.phone.replace(/\D/g, "").length < 8) {
    err.textContent = "Introduceți un telefon valid.";
    err.classList.remove("hidden");
    return;
  }
  if (!guest.accepted) {
    err.textContent = "Trebuie să acceptați regulamentul.";
    err.classList.remove("hidden");
    return;
  }
  if (isBlankCanvas()) {
    err.textContent = "Vă rugăm să semnați în chenar.";
    err.classList.remove("hidden");
    return;
  }

  const btn = $("#submitBtn");
  btn.disabled = true;
  btn.textContent = "Se salvează PDF-ul…";

  try {
    const apartment = state.config.apartments.find((a) => a.id === state.apartmentId);
    const signedAt = new Date().toLocaleString("ro-RO", {
      dateStyle: "long",
      timeStyle: "short",
    });
    const pdf = await buildPdf(guest, apartment, signedAt);
    const data = {
      emailSent: false,
      emailTo: HOST_EMAIL,
      downloadUrl: pdf,
    };
    const onPages = /\.github\.io$/i.test(location.hostname);
    if (!onPages) {
      fetch("api/semneaza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apartmentId: state.apartmentId,
          guest,
          pdf,
        }),
      }).catch(() => {});
    }
    await sendViaFormSubmit(guest, apartment, pdf);
    data.emailSent = true;
    $("#downloadLink").href = data.downloadUrl;
    $("#downloadLink").setAttribute("download", "acord-maravia.pdf");
    const lead = $("#doneLead");
    if (data.emailSent) {
      lead.textContent =
        "PDF-ul a fost trimis la " +
        HOST_EMAIL +
        ". Dacă nu vedeți un fișier .pdf atașat, căutați în Spam. Primul mesaj poate fi doar confirmarea — apăsați linkul, apoi semnați din nou.";
    } else {
      lead.textContent =
        "PDF-ul este salvat în arhivă, dar emailul nu a plecat. " +
        (data.emailError || "Verificați Mail pe Mac sau parola SMTP.");
    }
    step("done");
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Semnez și salvez PDF-ul";
  }
};

boot();
