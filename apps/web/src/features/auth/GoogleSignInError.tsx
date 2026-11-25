import { Link } from "react-router";

/**
 * Aviso al volver de Google sin poder entrar.
 * account_not_linked: ya hay una cuenta con ese mail, creada con contraseña y sin confirmar. Better Auth no la une a
 * Google hasta que se confirme el mail (accountLinking.requireLocalEmailVerified), para que nadie se quede con la
 * cuenta de otra persona registrando antes su mail. Una vez confirmado, entrar con Google une las dos.
 */
export function GoogleSignInError({ code, canReset }: { code: string; canReset: boolean }) {
  // Si canceló en Google no hace falta decir nada
  if (code === "access_denied") return null;
  if (code !== "account_not_linked") {
    return <p className="notice notice--error auth__notice" role="alert">No se pudo entrar con Google. Probá de nuevo.</p>;
  }
  return (
    <div className="notice notice--info auth__notice" role="alert">
      <b>Ya tenés una cuenta con ese mail</b>
      <span>Entrá con tu contraseña y confirmá el mail desde Yo. Después vas a poder entrar con Google.</span>
      {canReset && <Link to="/recuperar" className="linkbtn small">No me acuerdo la contraseña</Link>}
    </div>
  );
}
