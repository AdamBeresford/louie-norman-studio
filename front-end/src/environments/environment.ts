export const environment = {
    production: false,
    // Relative so requests hit whichever origin serves the app: the Express
    // server in production, or the dev-server proxy (proxy.conf.json) locally.
    baseUrl: '/api/'
};
