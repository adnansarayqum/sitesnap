import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { BottomSheet, Button } from "../ui/index.js";

// Two ways in from the camera: a QR code on a door plate or instruction
// sheet (decoded live, in view a beat later), or a single frame read
// through the same on-device OCR model Room's "Read text" already uses
// (src/ocr.js) — offline, no server call, nothing leaves the phone.
// html5-qrcode is imported dynamically inside the effect below so it never
// lands in the app's main bundle; it's only fetched once Scan is tapped.
export function QRScanner({ onClose, onAddressScanned }) {
  const html5QrcodeRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [scannedText, setScannedText] = useState(null); // a decoded QR payload, awaiting confirmation
  const [extractedData, setExtractedData] = useState(null); // parsed document fields, awaiting confirmation
  const [ocrInProgress, setOcrInProgress] = useState(false);
  const qrDetectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        // #qr-reader is always in this component's own render output (see
        // below) — it exists before this effect ever runs, which is what
        // the library's constructor requires; constructing it while the
        // element was still conditionally unmounted used to throw on every
        // attempt ("HTML Element with id=qr-reader not found").
        const qrcode = new Html5Qrcode("qr-reader");
        html5QrcodeRef.current = qrcode;
        await qrcode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            const text = decodedText.trim();
            if (text.length > 0 && !qrDetectedRef.current) {
              qrDetectedRef.current = true;
              // never write a scanned payload straight into the address —
              // a QR code can hold anything; the surveyor confirms first
              setScannedText(text);
            }
          },
          () => {} // per-frame scan misses; nothing to surface
        );
        if (!cancelled) setScanning(true);
      } catch (err) {
        if (cancelled) return;
        setError(typeof err === "string" ? err : (err && err.message) || "Failed to start camera");
        setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
      const qrcode = html5QrcodeRef.current;
      if (qrcode) qrcode.stop().catch(() => {}).finally(() => { try { qrcode.clear(); } catch { /* already torn down */ } });
    };
  }, []);

  const captureAndOCR = async () => {
    const video = document.querySelector("#qr-reader video");
    if (!video || !video.videoWidth) { setError("The camera isn't ready yet"); return; }
    try {
      setOcrInProgress(true);
      setError(null);
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      // the same offline, SW-cached model Room.jsx's "Read text" uses —
      // never the OCR library's default CDN worker, which is both blocked
      // by CSP in production and unavailable with no signal
      const { recognizeText } = await import("../ocr.js");
      const text = await recognizeText(canvas.toDataURL("image/jpeg", 0.9));
      const data = parseDocumentText(text);
      const hasAnything = data.address || data.postcode || data.reference || data.client || data.occupier || data.solicitor;
      if (!hasAnything) setError("Couldn't find an address or reference on that page — try holding it flatter and closer");
      else setExtractedData(data);
    } catch {
      setError("Couldn't read text from that page");
    } finally {
      setOcrInProgress(false);
    }
  };

  const parseDocumentText = (text) => {
    const lines = text.split("\n");
    const data = { address: "", postcode: "", reference: "", client: "", occupier: "", solicitor: "" };

    const postcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i;
    const refRegex = /(?:ref|reference|ref\.?)\s*[:#]?\s*([A-Za-z0-9\-\/]+)/i;
    const clientRegex = /(?:client|re:)\s*([^\n]+)/i;
    const occupierRegex = /(?:occupier|tenant|property owner)\s*[:#]?\s*([^\n]+)/i;
    const solicitorRegex = /(?:solicitor|legal|attorney)\s*[:#]?\s*([^\n]+)/i;

    let addressLines = [];
    let inAddress = true;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const postcodeMatch = trimmed.match(postcodeRegex);
      if (postcodeMatch) {
        data.postcode = postcodeMatch[0].toUpperCase();
        addressLines.push(trimmed.replace(postcodeRegex, "").trim());
        inAddress = false;
        continue;
      }

      if (inAddress && trimmed.match(/^[0-9\s,.a-zA-Z\-]+$/)) {
        addressLines.push(trimmed);
      } else if (inAddress) {
        inAddress = false;
      }

      const refMatch = trimmed.match(refRegex);
      if (refMatch) data.reference = refMatch[1];

      const clientMatch = trimmed.match(clientRegex);
      if (clientMatch) data.client = clientMatch[1];

      const occupierMatch = trimmed.match(occupierRegex);
      if (occupierMatch) data.occupier = occupierMatch[1];

      const solicitorMatch = trimmed.match(solicitorRegex);
      if (solicitorMatch) data.solicitor = solicitorMatch[1];
    }

    data.address = addressLines.join(", ").replace(/,\s*$/, "");
    return data;
  };

  const handleConfirmExtracted = () => { if (extractedData && extractedData.address) onAddressScanned(extractedData); };
  const handleConfirmQr = () => onAddressScanned(scannedText);

  if (extractedData) {
    return (
      <BottomSheet title="Confirm details" onClose={onClose} portal>
        <div className="ss-edit-form">
          <label>Address</label>
          <input value={extractedData.address} onChange={(e) => setExtractedData({ ...extractedData, address: e.target.value })} />
          <label>Postcode</label>
          <input value={extractedData.postcode} onChange={(e) => setExtractedData({ ...extractedData, postcode: e.target.value.toUpperCase() })} />
          <label>Reference</label>
          <input value={extractedData.reference} onChange={(e) => setExtractedData({ ...extractedData, reference: e.target.value })} />
          <label>Client</label>
          <input value={extractedData.client} onChange={(e) => setExtractedData({ ...extractedData, client: e.target.value })} />
          <label>Occupier</label>
          <input value={extractedData.occupier} onChange={(e) => setExtractedData({ ...extractedData, occupier: e.target.value })} />
          <label>Solicitor</label>
          <input value={extractedData.solicitor} onChange={(e) => setExtractedData({ ...extractedData, solicitor: e.target.value })} />
        </div>
        <div className="ss-finding-actions">
          <Button variant="primary" disabled={!extractedData.address.trim()} onClick={handleConfirmExtracted}><Check size={15} /> Use these details</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </BottomSheet>
    );
  }

  if (scannedText) {
    return (
      <BottomSheet title="Use this as the address?" onClose={onClose} portal>
        <p className="ss-fineprint" style={{ margin: "0 0 4px" }}>Scanned from the QR code:</p>
        <p className="ss-transcript">{scannedText}</p>
        <div className="ss-finding-actions">
          <Button variant="primary" onClick={handleConfirmQr}><Check size={15} /> Use as address</Button>
          <Button variant="ghost" onClick={() => { setScannedText(null); qrDetectedRef.current = false; }}>Scan again</Button>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet title="Scan address" onClose={onClose} portal>
      <div id="qr-reader" className="ss-qr-reader" />
      {!scanning && !error && <p className="ss-fineprint" style={{ marginTop: 8 }}>Starting camera…</p>}
      {error && <p className="ss-fineprint" style={{ marginTop: 8, color: "var(--red)" }}>{error}</p>}
      <div className="ss-finding-actions">
        <Button variant="primary" disabled={!scanning || ocrInProgress} onClick={captureAndOCR} style={{ flex: "1 1 100%" }}>
          {ocrInProgress ? "Reading page…" : "Extract document details"}
        </Button>
      </div>
      <p className="ss-fineprint">Point the camera at a QR code for a quick read, or at a letter/instruction sheet and tap Extract to pull the address and reference off the page.</p>
    </BottomSheet>
  );
}
