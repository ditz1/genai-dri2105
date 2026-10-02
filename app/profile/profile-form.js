'use client';

import { useActionState, useEffect, useState } from 'react';
import { updateProfile } from '../actions';
import { createClient } from '../../lib/supabase/client';
import Silhouette from '../silhouette';

const maxPhotoBytes = 5 * 1024 * 1024;
const photoTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export default function ProfileForm({ userId, firstName, lastName, avatarUrl }) {
  const [preview, setPreview] = useState(null);

  // Upload the photo straight to Storage, then hand the server action its path along with the names.
  async function save(previousState, formData) {
    const photo = formData.get('photo');
    formData.delete('photo');
    if (photo?.size > 0) {
      const extension = photoTypes[photo.type];
      if (!extension) return { error: 'Choose a JPEG, PNG, WebP, or GIF image.' };
      if (photo.size > maxPhotoBytes) return { error: 'Choose a photo smaller than 5 MB.' };
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await createClient().storage.from('avatars').upload(path, photo, { contentType: photo.type });
      if (error) return { error: 'Could not upload that photo. Try again.' };
      formData.set('avatar_path', path);
    }
    return updateProfile(previousState, formData);
  }

  const [state, formAction, pending] = useActionState(save, {});

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = preview ?? avatarUrl;
  return (
    <form action={formAction}>
      {shown
        ? <img className="avatar" src={shown} alt="Your profile photo" />
        : <Silhouette className="avatar" />}
      <label htmlFor="photo">Photo</label>
      <input
        id="photo"
        name="photo"
        type="file"
        accept={Object.keys(photoTypes).join(',')}
        onChange={(event) => {
          const file = event.target.files[0];
          setPreview(file ? URL.createObjectURL(file) : null);
        }}
      />
      <label htmlFor="first_name">First name</label>
      <input id="first_name" name="first_name" defaultValue={firstName} autoComplete="given-name" maxLength={80} required />
      <label htmlFor="last_name">Last name</label>
      <input id="last_name" name="last_name" defaultValue={lastName} autoComplete="family-name" maxLength={80} required />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.message && <p role="status">{state.message}</p>}
      <button disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button>
    </form>
  );
}
