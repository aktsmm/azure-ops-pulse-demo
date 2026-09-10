import type { NetworkAddressEvidence } from "../data/contracts";

export function NetworkEvidence({ evidence }: { evidence?: NetworkAddressEvidence }) {
  return (
    <section className="network-address-evidence" aria-label="ネットワーク構成のアドレス情報">
      <h3>収集したアドレス構成</h3>
      {evidence ? (
        <>
          <dl>
            <div><dt>プライベート IPv4</dt><dd>{evidence.privateIpv4.length ? evidence.privateIpv4.map((value) => <code key={value}>{value}</code>) : "今回の公開値なし"}</dd></div>
            <div><dt>プライベート CIDR</dt><dd>{evidence.privateCidrs.length ? evidence.privateCidrs.map((value) => <code key={value}>{value}</code>) : "今回の公開値なし"}</dd></div>
            <div><dt>パブリック IPv4（部分マスク）</dt><dd>{evidence.publicIpv4Masked.length ? evidence.publicIpv4Masked.map((value) => <code key={value}>{value}</code>) : "今回の公開値なし"}</dd></div>
          </dl>
          {evidence.truncated && <p className="notice">公開件数を制限しています。表示は全件ではありません。</p>}
          <p>アドレス構成の記録です。通信の許可・疎通・安全性や、未表示のアドレスがないことは示しません。</p>
        </>
      ) : <p>アドレス情報は未収集です。アドレス未設定や接続なしとは判断できません。</p>}
    </section>
  );
}
