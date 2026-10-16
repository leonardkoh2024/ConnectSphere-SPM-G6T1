import { useEffect, useState } from "react";
import { loadEquipmentCatalogue } from "./equipmentApi";

// Shared by the Equipment catalogue and Reservations screens: one read of the
// equipment service, with its loading and error state.
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

  return { catalogue, error, loading: !catalogue && !error };
}
