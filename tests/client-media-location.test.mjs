import assert from "node:assert/strict";
import test from "node:test";

import { imageGpsFromExifTags } from "../lib/client-media.ts";

test("expanded EXIF GPS values include altitude from the gps group", () => {
  assert.deepEqual(
    imageGpsFromExifTags({
      gps: {
        Latitude: 51.0504,
        Longitude: 13.7373,
        Altitude: 182.5,
      },
    }),
    {
      latitude: 51.0504,
      longitude: 13.7373,
      altitude: 182.5,
    },
  );
});

test("invalid or incomplete expanded GPS data is ignored", () => {
  assert.equal(imageGpsFromExifTags({ gps: { Latitude: 51.0504 } }), null);
  assert.equal(
    imageGpsFromExifTags({ gps: { Latitude: null, Longitude: null } }),
    null,
  );
  assert.deepEqual(
    imageGpsFromExifTags({ gps: { Latitude: 51.0504, Longitude: 13.7373 } }),
    { latitude: 51.0504, longitude: 13.7373 },
  );
});
