import Link from 'next/link';

export default function Header({ title, user, admin = false }) {
  return (
    <header className="site-header">
      <h1>{title}</h1>
      <nav>
        <Link href="/">People</Link>
        <Link href="/posts">Posts</Link>
        <Link href="/tournaments">Tournaments</Link>
        <Link href="/create">Create</Link>
        {admin && <Link href="/admin">Admin</Link>}
        {user ? <Link href="/profile">Profile</Link> : <Link href="/login">Log in</Link>}
      </nav>
    </header>
  );
}
