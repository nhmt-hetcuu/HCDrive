import { useState } from 'react'
import { Heart, Copy, Check, QrCode, Building2, CreditCard, UserCheck } from 'lucide-react'
import { DummyModal } from '@/components/drive/DummyModal'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/context/SnackbarContext'

export function DonateModal({
  open,
  onClose,
  lang,
}: {
  open: boolean
  onClose: () => void
  lang: 'vi' | 'en'
}) {
  const vi = lang === 'vi'
  const { showSnackbar } = useSnackbar()
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(true)

  const bankName = 'MB Bank (Ngân hàng TMCP Quân Đội)'
  const accountNumber = '01001200910010'
  const accountHolder = 'NGUYEN HOANG MINH TRI'
  const qrUrl = `https://img.vietqr.io/image/MB-${accountNumber}-compact2.png?amount=&addInfo=Donate%20HCDrive&accountName=${encodeURIComponent(accountHolder)}`

  function copyAccountNumber() {
    navigator.clipboard
      .writeText(accountNumber)
      .then(() => {
        setCopied(true)
        showSnackbar(vi ? 'Đã sao chép số tài khoản!' : 'Account number copied!')
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => {
        showSnackbar(vi ? 'Không thể sao chép tự động' : 'Could not copy')
      })
  }

  return (
    <DummyModal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-semibold">
          <Heart className="h-5 w-5 text-rose-500 fill-rose-500/20" />
          <span>{vi ? 'Ủng hộ tác giả (Donate)' : 'Donate / Support Developer'}</span>
        </div>
      }
      description={
        vi
          ? 'Nếu bạn yêu thích HCDrive, hãy ủng hộ tác giả một ly cà phê để tiếp tục duy trì và phát triển tính năng mới nhé!'
          : 'If you enjoy using HCDrive, support the developer to help maintain and build awesome new features!'
      }
      className="max-w-md"
    >
      <div className="space-y-4 pt-1 text-sm text-slate-700 dark:text-slate-300">
        {/* VietQR Code Card */}
        {showQr && (
          <div className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            <img
              src={qrUrl}
              alt="VietQR MB Bank - NGUYEN HOANG MINH TRI"
              className="max-w-[240px] w-full rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 bg-white"
              loading="lazy"
            />
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 text-center">
              {vi ? 'Quét mã VietQR bằng ứng dụng ngân hàng bất kỳ' : 'Scan VietQR with any banking application'}
            </p>
          </div>
        )}

        {/* Bank Information Details */}
        <div className="space-y-2 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 p-3.5">
          {/* Bank */}
          <div className="flex items-start justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 shrink-0">
              <Building2 className="h-3.5 w-3.5 text-blue-500" />
              <span>{vi ? 'Ngân hàng' : 'Bank'}</span>
            </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100 text-right">
              {bankName}
            </span>
          </div>

          {/* Account Number */}
          <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-slate-200/60 dark:border-slate-800">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 shrink-0">
              <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
              <span>{vi ? 'Số tài khoản' : 'Account No.'}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm text-[#0b57d0] dark:text-[#a8c7fa] tracking-wider">
                {accountNumber}
              </span>
              <button
                type="button"
                onClick={copyAccountNumber}
                className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer"
                title={vi ? 'Sao chép số tài khoản' : 'Copy account number'}
                aria-label="Copy account number"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Account Holder */}
          <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-slate-200/60 dark:border-slate-800">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 shrink-0">
              <UserCheck className="h-3.5 w-3.5 text-purple-500" />
              <span>{vi ? 'Chủ tài khoản' : 'Account Name'}</span>
            </span>
            <span className="font-bold text-slate-900 dark:text-slate-100 tracking-wide">
              {accountHolder}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowQr(!showQr)}
            className="text-xs h-8 rounded-full border-slate-300 dark:border-slate-700"
          >
            <QrCode className="h-3.5 w-3.5 mr-1.5" />
            {showQr ? (vi ? 'Ẩn mã QR' : 'Hide QR') : (vi ? 'Hiện mã QR' : 'Show QR')}
          </Button>

          <Button
            type="button"
            variant="filled"
            size="sm"
            onClick={copyAccountNumber}
            className="text-xs h-8 rounded-full bg-[#0b57d0] hover:bg-[#0b57d0]/90 text-white"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                {vi ? 'Đã sao chép STK' : 'Copied'}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                {vi ? 'Sao chép STK' : 'Copy Account'}
              </>
            )}
          </Button>
        </div>
      </div>
    </DummyModal>
  )
}
