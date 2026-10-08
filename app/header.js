import Link from 'next/link';

export default function Header({ title, user }) {
  return (
    <header className="site-header">
      <h1>{title}</h1>
      <nav>
        <Link href="/">People</Link>
        <Link href="/posts">Posts</Link>
        <Link href="/create">Create</Link>
        {user ? <Link href="/profile">Profile</Link> : <Link href="/login">Log in</Link>}
      </nav>
    </header>
  );
}
