import Secret from 'gi://Secret';

// GitHub tokens live in the GNOME Keyring, keyed by host; never in GSettings.
const SCHEMA = new Secret.Schema('org.gnome.shell.extensions.widgets-distro-com.github',
  Secret.SchemaFlags.NONE, {host: Secret.SchemaAttributeType.STRING});

const call = (fn, finish, ...args) => new Promise((resolve, reject) => {
  fn(SCHEMA, ...args, null, (_source, result) => {
    try {
      resolve(finish(result));
    } catch (error) {
      reject(error);
    };
  });
});

export const lookupToken = host =>
  call(Secret.password_lookup, Secret.password_lookup_finish, {host});

export const storeToken = (host, token) =>
  call(Secret.password_store, Secret.password_store_finish, {host},
    Secret.COLLECTION_DEFAULT, `Widgets: GitHub token (${host})`, token);

export const clearToken = host =>
  call(Secret.password_clear, Secret.password_clear_finish, {host});

export const normalizeHost = host => host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
