declare global {
  interface Window {
    google?: any;
    __veromedGoogleMapsPromise?: Promise<any>;
  }
}

export function loadGoogleMaps(): Promise<any> {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google);
  if (window.__veromedGoogleMapsPromise) return window.__veromedGoogleMapsPromise;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_API_KEY?.trim();
  if (!apiKey) return Promise.reject(new Error('Google Maps Browser API key is not configured.'));

  window.__veromedGoogleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = '__veromedGoogleMapsReady';
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve(window.google);
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete (window as any)[callbackName];
      window.__veromedGoogleMapsPromise = undefined;
      reject(new Error('Google Maps could not be loaded. Check the API key and website restrictions.'));
    };
    document.head.appendChild(script);
  });

  return window.__veromedGoogleMapsPromise;
}

export {};
