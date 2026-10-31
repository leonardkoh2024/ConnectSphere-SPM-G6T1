import { useCallback, useEffect, useState } from "react";
import { loadEquipmentCatalogue } from "./equipmentApi";

// Shared by the Equipment catalogue and Reservations screens: one read of the
// equipment service, with its loading and error state. `reload` (G6) reads it again after
// Technical Support act on a reservation, and answers whether the list was refreshed, so a
// failed refresh after a successful action is not shown as a failed action.
export default function useEquipmentCatalogue() {
  const [catalogue, setCatalogue] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    loadEquipmentCatalogue()
      .then((result) => { if (mounted) setCatalogue(result); })
      .catch((loadError) => { if (mounted) setError(loadError.message); });
    return () => { mounted = false; };
  }, []);

  const reload = useCallback(async () => {
    try {
      setCatalogue(await loadEquipmentCatalogue());
      return true;
    } catch (_error) {
      return false;
    }
  }, []);

  return { catalogue, error, loading: !catalogue && !error, reload };
}
