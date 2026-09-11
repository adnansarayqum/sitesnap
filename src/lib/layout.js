// Where an inspection's files live in the cloud (and in a ZIP), in one place
// so the background filer, the Export tab, the webhook fields and the notes
// record can never disagree:
//
//   Inspections/<address>/Site photos/01. Kitchen/01 Kitchen - caption.jpg
//   Inspections/<address>/Inspection/inspection.json | findings | voice notes | ID photo
//
// The parent folder holds exactly two sub-folders, so a report-writer opening
// the case finds the photographs in one place and everything about the
// inspection itself in the other.
import { pad } from "./util.js";

export const SITE_PHOTOS = "Site photos";
export const INSPECTION = "Inspection";

export const roomFolder = (idx, name) => `${pad(idx + 1)}. ${name}`;
// the `folder` field a webhook receives: relative to the address folder
export const photoFolder = (idx, name) => `${SITE_PHOTOS}/${roomFolder(idx, name)}`;
// path segments for a direct drive upload, relative to the app root
export const photoSegments = (address, idx, name) => ["Inspections", address, SITE_PHOTOS, roomFolder(idx, name)];
export const inspectionSegments = (address) => ["Inspections", address, INSPECTION];
