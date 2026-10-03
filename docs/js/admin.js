const form = document.getElementById("pinForm");
const err = document.getElementById("pinError");
const list = document.getElementById("files");

form.onsubmit = async (e) => {
  e.preventDefault();
  err.classList.add("hidden");
  const pin = new FormData(form).get("pin");
  try {
    const res = await fetch("api/acorduri", { headers: { "x-pin": pin } });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || "PIN greșit.";
      err.classList.remove("hidden");
      return;
    }
    sessionStorage.setItem("pinGazda", pin);
    render(data.files);
  } catch (ex) {
    err.textContent =
      "Pe linkul public PDF-urile ajung pe email (iugaica@yahoo.com). Arhiva locală funcționează doar cu python3 server.py.";
    err.classList.remove("hidden");
  }
};

function render(files) {
  if (!files.length) {
    list.innerHTML = "<li>Încă nu există acorduri semnate.</li>";
    return;
  }
  list.innerHTML = files
    .map((f) => {
      const when = new Date(f.createdAt).toLocaleString("ro-RO");
      const url = "api/descarca/" + encodeURIComponent(f.fileName);
      return `<li><span>${f.fileName}<br /><small>${when}</small></span><a href="${url}">Descarcă</a></li>`;
    })
    .join("");
}

const saved = sessionStorage.getItem("pinGazda");
if (saved) {
  form.pin.value = saved;
  form.requestSubmit();
}
