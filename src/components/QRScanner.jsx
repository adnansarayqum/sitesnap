import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { X } from "lucide-react";

export function QRScanner({ onClose, onAddressScanned }) {
  const scannerRef = useRef(null);
  const html5QrcodeRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const startScanning = async () => {
      try {
        setError(null);
        const qrcode = new Html5Qrcode("qr-reader");
        html5QrcodeRef.current = qrcode;

        await qrcode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            const text = decodedText.trim();
            if (text.length > 0) {
              onAddressScanned(text);
            }
          },
          (errorMessage) => {
          }
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

  const handleClose = () => {
    if (html5QrcodeRef.current) {
      html5QrcodeRef.current.stop().catch(() => {});
    }
    onClose();
  };

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
          <div id="qr-reader" />
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
