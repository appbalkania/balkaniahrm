"use client";

import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import "./kiosk.css";
import { Icon } from "../../components/icons";
import {
  clearKioskSession,
  identifyEmployee,
  isKioskSessionInvalidError,
  kioskErrorMessage,
  loadKioskSession,
  pairDevice,
  recordKioskAttendance,
  saveKioskSession,
  type IdentifiedEmployee,
  type KioskSession,
} from "../../lib/kiosk-service";
import type { AttendanceEventType } from "../../lib/domain";

const eventLabels: Record<AttendanceEventType, string> = {
  clock_in: "Clock in",
  clock_out: "Clock out",
  break_start: "Start break",
  break_end: "End break",
  lunch_start: "Start lunch",
  lunch_end: "End lunch",
};

const stateLabels: Record<IdentifiedEmployee["state"], string> = {
  not_started: "Not started yet",
  working: "Currently working",
  on_break: "On break",
  on_lunch: "On lunch",
  complete: "Day complete",
};

type Phase = "loading" | "pairing" | "scanning" | "identified";
type CameraError = "denied" | "no-camera" | null;

export default function KioskPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<KioskSession | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pin, setPin] = useState("");
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<CameraError>(null);
  const [employee, setEmployee] = useState<IdentifiedEmployee | null>(null);
  const [recordingAction, setRecordingAction] = useState<AttendanceEventType | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [reauthBanner, setReauthBanner] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const existing = loadKioskSession();
    if (existing) {
      setSession(existing);
      setPhase("scanning");
    } else {
      setPhase("pairing");
    }
  }, []);

  function backToPairing(message: string) {
    clearKioskSession();
    setSession(null);
    setEmployee(null);
    setReauthBanner(message);
    setPhase("pairing");
  }

  async function handlePair(event: React.FormEvent) {
    event.preventDefault();
    setPairError(null);
    setPairing(true);
    try {
      const next = await pairDevice(pin);
      saveKioskSession(next);
      setSession(next);
      setPin("");
      setReauthBanner(null);
      setPhase("scanning");
    } catch (err) {
      setPairError(kioskErrorMessage(err));
    } finally {
      setPairing(false);
    }
  }

  async function handleDecoded(qrToken: string) {
    if (busyRef.current || !session) return;
    busyRef.current = true;
    try {
      const identified = await identifyEmployee(session.sessionToken, qrToken);
      setEmployee(identified);
      setPhase("identified");
    } catch (err) {
      if (isKioskSessionInvalidError(err)) {
        backToPairing(kioskErrorMessage(err));
        return;
      }
      setScanMessage(kioskErrorMessage(err));
      setTimeout(() => setScanMessage(null), 2500);
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    if (phase !== "scanning" || !videoRef.current) return;

    let cancelled = false;
    setCameraError(null);

    QrScanner.hasCamera().then((has) => {
      if (cancelled) return;
      if (!has) {
        setCameraError("no-camera");
        setManualEntryOpen(true);
        return;
      }
      const scanner = new QrScanner(videoRef.current!, (result) => handleDecoded(result.data), {
        preferredCamera: "environment",
        highlightScanRegion: true,
        highlightCodeOutline: true,
      });
      scannerRef.current = scanner;
      scanner.start().catch(() => {
        if (!cancelled) setCameraError("denied");
      });
    });

    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session]);

  function retryCamera() {
    setCameraError(null);
    scannerRef.current?.start().catch(() => setCameraError("denied"));
  }

  async function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!manualToken.trim()) return;
    await handleDecoded(manualToken.trim());
    setManualToken("");
  }

  async function handleAction(eventType: AttendanceEventType) {
    if (!session || !employee) return;
    setRecordingAction(eventType);
    try {
      await recordKioskAttendance(session.sessionToken, employee.employeeId, eventType, crypto.randomUUID());
      setConfirmation(`${eventLabels[eventType]} recorded for ${employee.fullName}.`);
      setTimeout(() => {
        setConfirmation(null);
        setEmployee(null);
        setPhase("scanning");
      }, 2000);
    } catch (err) {
      if (isKioskSessionInvalidError(err)) {
        backToPairing(kioskErrorMessage(err));
        return;
      }
      setScanMessage(kioskErrorMessage(err));
      setEmployee(null);
      setPhase("scanning");
      setTimeout(() => setScanMessage(null), 2500);
    } finally {
      setRecordingAction(null);
    }
  }

  if (phase === "loading") {
    return (
      <main className="kiosk kiosk-center">
        <Icon name="spinner" size={28} className="spin" />
      </main>
    );
  }

  if (phase === "pairing") {
    return (
      <main className="kiosk kiosk-center">
        <div className="kiosk-pair-card">
          <Icon name="device" size={32} />
          <h1>Pair this device</h1>
          <p className="kiosk-muted">Enter the PIN shown when this kiosk was registered in Balkania Admin.</p>
          {reauthBanner && (
            <div className="kiosk-banner">
              <Icon name="warning" size={16} /> {reauthBanner}
            </div>
          )}
          <form onSubmit={handlePair}>
            <input
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="kiosk-pin-input"
              disabled={pairing}
            />
            {pairError && (
              <p className="kiosk-error">
                <Icon name="warning" size={15} /> {pairError}
              </p>
            )}
            <button className="kiosk-primary-button" type="submit" disabled={pairing || pin.length !== 6}>
              {pairing ? "Pairing…" : "Pair device"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (phase === "scanning") {
    return (
      <main className="kiosk kiosk-scanner">
        <div className="kiosk-scanner-video-wrap">
          <video ref={videoRef} className="kiosk-scanner-video" muted playsInline />
          {!cameraError && (
            <div className="kiosk-scanner-caption">
              <Icon name="qr" size={22} /> Point the camera at your QR code
            </div>
          )}
          {cameraError === "denied" && (
            <div className="kiosk-scanner-overlay">
              <Icon name="warning" size={32} />
              <p>Camera access is required. Allow it in your browser settings and try again.</p>
              <button className="kiosk-primary-button" onClick={retryCamera}>Try again</button>
            </div>
          )}
          {cameraError === "no-camera" && (
            <div className="kiosk-scanner-overlay">
              <Icon name="warning" size={32} />
              <p>No camera was found on this device. Use the manual entry below instead.</p>
            </div>
          )}
          {scanMessage && <div className="kiosk-toast">{scanMessage}</div>}
        </div>
        <div className="kiosk-manual">
          <button className="kiosk-text-button" onClick={() => setManualEntryOpen((v) => !v)}>
            {manualEntryOpen ? "Hide manual entry" : "Enter code manually"}
          </button>
          {manualEntryOpen && (
            <form onSubmit={handleManualSubmit} className="kiosk-manual-form">
              <input value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="Paste attendance code" />
              <button className="kiosk-secondary-button" type="submit">Submit</button>
            </form>
          )}
        </div>
      </main>
    );
  }

  if (phase === "identified" && employee) {
    const [primary, ...rest] = employee.validActions;
    return (
      <main className="kiosk kiosk-center">
        <div className="kiosk-identified-card">
          {confirmation ? (
            <>
              <Icon name="check" size={40} />
              <p className="kiosk-confirmation">{confirmation}</p>
            </>
          ) : (
            <>
              <h1>{employee.fullName}</h1>
              <p className="kiosk-muted">{employee.employeeCode} · {stateLabels[employee.state]}</p>
              {primary && (
                <button className="kiosk-primary-button kiosk-action-primary" disabled={recordingAction !== null} onClick={() => handleAction(primary)}>
                  {recordingAction === primary ? "Recording…" : eventLabels[primary]}
                </button>
              )}
              {rest.length > 0 && (
                <div className="kiosk-secondary-actions">
                  {rest.map((action) => (
                    <button key={action} className="kiosk-secondary-button" disabled={recordingAction !== null} onClick={() => handleAction(action)}>
                      {recordingAction === action ? "Recording…" : eventLabels[action]}
                    </button>
                  ))}
                </div>
              )}
              <button className="kiosk-secondary-button kiosk-scan-again-button" onClick={() => setPhase("scanning")}>
                <Icon name="qr" size={17} /> Not you? Scan again
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  return null;
}
