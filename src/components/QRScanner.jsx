import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import Tesseract from "tesseract.js";
import { X, Check } from "lucide-react";

export function QRScanner({ onClose, onAddressScanned }) {
  const html5QrcodeRef = useRef(null);
  const canvasRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [ocrInProgress, setOcrInProgress] = useState(false);
  const qrDetectedRef = useRef(false);

  useEffect(() => {
    const startScanning = async () => {
      try {
        setError(null);
        const qrcode = new Html5Qrcode("qr-reader");
        html5QrcodeRef.current = qrcode;

        await qrcode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            const text = decodedText.trim();
            if (text.length > 0 && !qrDetectedRef.current) {
              qrDetectedRef.current = true;
              onAddressScanned(text);
            }
          },
          () => {}
        );
        setScanning(true);
      } catch (err) {
        setError(err.message || "Failed to start camera");
        setScanning(false);
      }
    };

    startScanning();

    return () => {
      if (html5QrcodeRef.current) {
        html5QrcodeRef.current.stop().catch(() => {});
      }
    };
  }, [onAddressScanned]);

  const captureAndOCR = async () => {
    if (!html5QrcodeRef.current) return;

    try {
      setOcrInProgress(true);
      setError(null);

      const canvas = await html5QrcodeRef.current.getVideoFrame();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));

      const result = await Tesseract.recognize(blob, "eng", {
        logger: () => {},
      });

      const text = result.data.text;
      const data = parseDocumentText(text);
      setExtractedData(data);
    } catch (err) {
      setError("Failed to extract text from document");
    } finally {
      setOcrInProgress(false);
    }
  };

  const parseDocumentText = (text) => {
    const lines = text.split("\n");
    const data = {
      address: "",
      postcode: "",
      reference: "",
      client: "",
      occupier: "",
      solicitor: "",
    };

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

  const handleClose = () => {
    if (html5QrcodeRef.current) {
      html5QrcodeRef.current.stop().catch(() => {});
    }
    onClose();
  };

  const handleConfirmExtracted = () => {
    if (extractedData?.address) {
      onAddressScanned(extractedData);
    }
  };

  if (extractedData && extractedData.address) {
    return (
      <div className="qr-scanner-overlay">
        <div className="qr-scanner-container">
          <div className="qr-scanner-header">
            <h2 className="qr-scanner-title">Confirm details</h2>
            <button className="qr-scanner-close" onClick={handleClose}>
              <X size={20} />
            </button>
          </div>

          <div className="qr-extracted-fields">
            <div className="qr-field">
              <label>Address</label>
              <input
                type="text"
                value={extractedData.address}
                onChange={(e) =>
                  setExtractedData({ ...extractedData, address: e.target.value })
                }
                className="qr-field-input"
              />
            </div>
            <div className="qr-field">
              <label>Postcode</label>
              <input
                type="text"
                value={extractedData.postcode}
                onChange={(e) =>
                  setExtractedData({
                    ...extractedData,
                    postcode: e.target.value.toUpperCase(),
                  })
                }
                className="qr-field-input"
              />
            </div>
            <div className="qr-field">
              <label>Reference</label>
              <input
                type="text"
                value={extractedData.reference}
                onChange={(e) =>
                  setExtractedData({ ...extractedData, reference: e.target.value })
                }
                className="qr-field-input"
              />
            </div>
            <div className="qr-field">
              <label>Client</label>
              <input
                type="text"
                value={extractedData.client}
                onChange={(e) =>
                  setExtractedData({ ...extractedData, client: e.target.value })
                }
                className="qr-field-input"
              />
            </div>
            <div className="qr-field">
              <label>Occupier</label>
              <input
                type="text"
                value={extractedData.occupier}
                onChange={(e) =>
                  setExtractedData({ ...extractedData, occupier: e.target.value })
                }
                className="qr-field-input"
              />
            </div>
            <div className="qr-field">
              <label>Solicitor</label>
              <input
                type="text"
                value={extractedData.solicitor}
                onChange={(e) =>
                  setExtractedData({ ...extractedData, solicitor: e.target.value })
                }
                className="qr-field-input"
              />
            </div>
          </div>

          <div className="qr-scanner-actions">
            <button className="qr-action-btn qr-action-cancel" onClick={handleClose}>
              Cancel
            </button>
            <button
              className="qr-action-btn qr-action-confirm"
              onClick={handleConfirmExtracted}
            >
              <Check size={18} /> Use these details
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="qr-scanner-overlay">
      <div className="qr-scanner-container">
        <div className="qr-scanner-header">
          <h2 className="qr-scanner-title">Scan address</h2>
          <button className="qr-scanner-close" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        {scanning ? (
          <>
            <div id="qr-reader" />
            <button
              className="qr-capture-btn"
              onClick={captureAndOCR}
              disabled={ocrInProgress}
            >
              {ocrInProgress ? "Extracting text…" : "Extract document details"}
            </button>
          </>
        ) : (
          <div className="qr-scanner-loading">
            {error ? (
              <p className="qr-scanner-error">{error}</p>
            ) : (
              <p>Starting camera…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
