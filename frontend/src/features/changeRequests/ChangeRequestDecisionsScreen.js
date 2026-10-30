// I2 / SCRUM-148 — the coordinator's Change requests screen: the requests on the events
// assigned to them, Pending first, each opened to be weighed and then accepted or
// declined. The decided ones stay listed with the outcome and its reason.

import React, { useCallback, useEffect, useState } from "react";
import { PENDING } from "../../domain/changeRequests";
import { ChangeRequestRecord } from "./ChangeRequestsScreen";
import ChangeDecisionPanel from "./components/ChangeDecisionPanel";
import { acceptChangeRequest, declineChangeRequest, loadAssignedChangeRequests, loadChangeReview } from "./changeDecisionApi";
import { reviewApi } from "../events/reviewApi";

const RETRY_FAILED = "The arrangements could not be marked for re-request.";

export default function ChangeRequestDecisionsScreen({ user, onNotice }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(null);

  const reload = useCallback(async () => {
    setRequests(await loadAssignedChangeRequests(user.uid));
  }, [user.uid]);

  useEffect(() => {
    let mounted = true;
    loadAssignedChangeRequests(user.uid)
      .then((found) => { if (mounted) setRequests(found); })
      .catch((failure) => {
        console.error("Could not load change requests:", failure);
        if (mounted) setLoadError("The change requests could not be loaded. Try again.");
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [user.uid]);

  const open = async (request) => {
    setOpenId(request.id);
    setReview(null);
    setError("");
    try {
      setReview(await loadChangeReview(request));
    } catch (failure) {
      console.error("Could not load the change review:", failure);
      setError("This request could not be opened. Try again.");
    }
  };

  const close = () => { setOpenId(null); setReview(null); setError(""); };

  const finish = async (message) => {
    close();
    onNotice?.(message);
    try { await reload(); } catch (failure) { console.error("Could not refresh change requests:", failure); }
  };

  const accept = async (request, note) => {
    setBusy(true);
    setError("");
    try {
      const result = await acceptChangeRequest({ request, review, note });
      if (result?.rerequest && result.rerequest.sent === false) {
        setRetry({ request, changeId: result.rerequest.changeId, error: result.rerequest.error || RETRY_FAILED });
        close();
        await reload();
        return;
      }
      await finish("Change accepted and applied. The organiser has been told.");
    } catch (failure) {
      if (failure.message.startsWith("The existing arrangements changed")) {
        try {
          setReview(await loadChangeReview(request));
          setError("The arrangements changed while you were reviewing. Check the updated list, then accept again.");
        } catch (_reloadFailure) {
          setError(failure.message);
        }
      } else setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const decline = async (request, reason) => {
    setBusy(true);
    setError("");
    try {
      await declineChangeRequest({ request, reason });
      await finish("Change declined. The organiser has been told why.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const retryRerequest = async () => {
    setBusy(true);
    try {
      await reviewApi.retryRerequest({ eventId: retry.request.event_id, changeId: retry.changeId });
      setRetry(null);
      onNotice?.("Change accepted and applied. The affected arrangements were marked for re-request.");
    } catch (failure) {
      setRetry((current) => ({ ...current, error: failure.message || RETRY_FAILED }));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="cs-panel-note">Loading change requests…</p>;
  if (loadError) return <p className="cs-error" role="alert">{loadError}</p>;

  return (
    <div className="cs-record-list" aria-label="Change requests on your events">
      {retry && (
        <div className="cs-error" role="alert">
          <p>The change to {retry.request.event_name} was applied, but {retry.error.charAt(0).toLowerCase()}{retry.error.slice(1)}</p>
          <button type="button" className="cs-btn cs-btn-secondary" disabled={busy} onClick={retryRerequest}>Retry</button>
        </div>
      )}
      {!requests.length && <div className="cs-empty"><p>No change requests on your events.</p></div>}
      {requests.map((request) => (
        <ChangeRequestRecord key={request.id} request={request}>
          {request.status === PENDING && openId !== request.id && (
            <div className="cs-review-actions">
              <button type="button" className="cs-btn cs-btn-primary" onClick={() => open(request)}>Review change</button>
            </div>
          )}
          {openId === request.id && (review
            ? (
              <ChangeDecisionPanel
                request={request} review={review} busy={busy} error={error}
                onAccept={(note) => accept(request, note)} onDecline={(reason) => decline(request, reason)} onClose={close}
              />
            )
            : (error ? <p className="cs-error" role="alert">{error}</p> : <p className="cs-panel-note">Loading the event's arrangements…</p>))}
        </ChangeRequestRecord>
      ))}
    </div>
  );
}
