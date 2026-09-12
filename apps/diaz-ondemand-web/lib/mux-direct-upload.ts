/**
 * Sends a file to a Mux direct upload URL straight from the browser.
 *
 * One `PUT` of the whole file, with no upload library. The URL Mux issues is a
 * Google Cloud Storage resumable-upload session, which accepts the complete
 * body in a single request; `@mux/upchunk` exists to split that into retried
 * chunks for flaky connections and multi-gigabyte files, and it is the upgrade
 * path if uploads here prove to fail mid-way. Until they do, a dependency
 * whose whole job is retry buys nothing over "choose the file again", and the
 * API already starts a fresh upload for exactly that click.
 *
 * `XMLHttpRequest` rather than `fetch` because it is the only browser API that
 * reports upload progress, and the progress bar is the point of the control.
 */
export function uploadFileToMux(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`The upload was refused (HTTP ${request.status}).`));
      }
    });
    request.addEventListener('error', () => {
      reject(new Error('The connection to Mux was lost during the upload.'));
    });
    request.addEventListener('abort', () => {
      reject(new Error('The upload was cancelled.'));
    });

    request.open('PUT', url);
    request.send(file);
  });
}
