// Loaded on demand, not at startup: MSAL and Google's SDK are only weight
// worth paying for a surveyor who actually connects a direct cloud link —
// everyone else is here to shoot photos, and that path stays light.
export const loadMsGraph = () => import("./msGraph.js");
export const loadGoogleDrive = () => import("./googleDrive.js");
