import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { clearToken, lookupToken, normalizeHost, storeToken } from './secret.js';

export default class WidgetsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({
      title: 'GitHub Activity',
      description: 'Use a personal access token with only the read:user scope. It is stored in the GNOME Keyring.',
    });

    const hostRow = new Adw.EntryRow({title: 'Host (github.com or your Enterprise host)', show_apply_button: true});
    const tokenRow = new Adw.PasswordEntryRow({title: 'Token', show_apply_button: true});
    const removeButton = new Gtk.Button({
      icon_name: 'user-trash-symbolic',
      tooltip_text: 'Remove token from keyring',
      valign: Gtk.Align.CENTER,
      css_classes: ['flat'],
    });
    const host = () => normalizeHost(settings.get_string('github-host'));
    const toast = title => window.add_toast(new Adw.Toast({title}));
    const loadToken = () => {
      tokenRow.text = '';
      removeButton.sensitive = false;

      if (host()) {
        lookupToken(host()).then(token => {
          tokenRow.text = token ?? '';
          removeButton.sensitive = Boolean(token);
        }).catch(error => toast(`Keyring: ${error.message}`));
      };
    };

    hostRow.text = settings.get_string('github-host');
    hostRow.connect('apply', () => settings.set_string('github-host', normalizeHost(hostRow.text)));
    settings.connect('changed::github-host', loadToken);

    tokenRow.connect('apply', () => {
      if (!host()) {
        toast('Set the host first');
        return;
      };

      const token = tokenRow.text.trim();

      (token ? storeToken(host(), token) : clearToken(host()))
        .then(() => {
          removeButton.sensitive = Boolean(token);
          toast(token ? 'Token saved to keyring' : 'Token removed');
        })
        .catch(error => toast(`Keyring: ${error.message}`));
    });

    removeButton.connect('clicked', () => {
      clearToken(host()).then(() => loadToken()).catch(error => toast(`Keyring: ${error.message}`));
    });
    tokenRow.add_suffix(removeButton);

    group.add(hostRow);
    group.add(tokenRow);
    page.add(group);
    window.add(page);
    loadToken();
  };
};
