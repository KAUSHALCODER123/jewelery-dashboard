declare global {
  interface Window {
    api: {
      auth: {
        status(): Promise<{ user: any; userCount: number; defaultPassword: boolean }>
        login(p: { username: string; password: string }): Promise<any>
        logout(): Promise<boolean>
        list(): Promise<any[]>
        addUser(p: any): Promise<any>
        setActive(p: any): Promise<boolean>
        setRole(p: any): Promise<boolean>
        changePassword(p: any): Promise<boolean>
        resetPassword(p: any): Promise<boolean>
        removeUser(p: any): Promise<boolean>
        permissions(): Promise<Record<string, boolean> & { role: string | null }>
      }
      company: { read(): Promise<any>; save(p: any): Promise<any> }
      settings: { all(): Promise<Record<string, string>>; set(p: any): Promise<boolean> }

      itemType: { list(): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      itemGroup: { list(): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      design: { list(): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      item: { list(p?: any): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      rateMaster: {
        list(p?: any): Promise<any[]>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        resolve(p: any): Promise<any>
      }
      gridPref: {
        read(p: any): Promise<any[]>
        save(p: any): Promise<any>
        reset(p: any): Promise<any>
        all(): Promise<any[]>
      }
      branch: {
        list(): Promise<any[]>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        stock(): Promise<any[]>
      }
      stockTransfer: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }

      tagStock: {
        list(p?: any): Promise<any[]>
        nextTag(p: any): Promise<string>
        saveBatch(p: any): Promise<any>
        updateRows(p: any): Promise<any>
        remove(p: any): Promise<any>
        findByTag(p: any): Promise<any>
        search(p: any): Promise<any[]>
        markPrinted(p: any): Promise<any>
        clearPrinted(p: any): Promise<any>
      }
      looseStock: {
        summary(p?: any): Promise<any>
        ledger(p?: any): Promise<any[]>
        convert(p: any): Promise<any>
        opening(p: any): Promise<any>
        openingBalances(): Promise<any[]>
      }
      party: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        balance(p: any): Promise<{ balance: number }>
        metalBalance(p: any): Promise<{ balance: number; metal: string }>
        loyaltyBalance(p: any): Promise<{ balance: number; enabled: boolean }>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      account: { list(): Promise<any[]>; save(p: any): Promise<any>; nextCode(): Promise<string> }
      series: { list(p?: any): Promise<any[]>; peek(p: any): Promise<string>; save(p: any): Promise<any> }

      sale: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
        forPrint(p: any): Promise<any>
      }
      purchase: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      refinery: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      order: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        setStatus(p: any): Promise<any>
        remove(p: any): Promise<any>
        toInvoice(p: any): Promise<any>
      }
      voucher: { list(p?: any): Promise<any[]>; save(p: any): Promise<any>; remove(p: any): Promise<any> }
      karagir: {
        ledger(p?: any): Promise<any>
        issue(p: any): Promise<any>
        receive(p: any): Promise<any>
        removeIssue(p: any): Promise<any>
        removeReceive(p: any): Promise<any>
      }
      saleReturn: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      purchaseReturn: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }
      stockSettlement: {
        list(p?: any): Promise<any[]>
        read(p: any): Promise<any>
        save(p: any): Promise<any>
        remove(p: any): Promise<any>
      }

      gss: {
        schemes(): Promise<any[]>
        saveScheme(p: any): Promise<any>
        removeScheme(p: any): Promise<any>
        types(): Promise<string[]>
        merge(p: any): Promise<any>
        accounts(p?: any): Promise<any[]>
        readAccount(p: any): Promise<any>
        assign(p: any): Promise<any>
        balance(p: any): Promise<any>
        receive(p: any): Promise<any>
        unreceive(p: any): Promise<any>
        closeAccount(p: any): Promise<any>
        removeAccount(p: any): Promise<any>
      }
      reports: {
        stock(p?: any): Promise<any>
        ledger(p: any): Promise<any>
        metalLedger(p: any): Promise<any>
        accountCumStock(p: any): Promise<any>
        orderTracking(p?: any): Promise<any[]>
        metalOutstanding(p?: any): Promise<any[]>
        dayBook(p: any): Promise<any>
        outstanding(p?: any): Promise<any[]>
        outstandingList(p?: any): Promise<any>
        reorder(): Promise<any[]>
        gstRegister(p: any): Promise<any[]>
        dashboard(): Promise<any>
        trialBalance(p?: any): Promise<any>
        profitAndLoss(p?: any): Promise<any>
        balanceSheet(p?: any): Promise<any>
        cashBook(p?: any): Promise<any>
        journal(p?: any): Promise<any>
        register(p?: any): Promise<any>
        gstReturn(p?: any): Promise<any>
        gstSummary(p?: any): Promise<any>
        hsnSummary(p?: any): Promise<any>
        tcsTds(p?: any): Promise<any>
        schemeReport(p?: any): Promise<any>
        mis(p?: any): Promise<any>
        reconcile(p?: any): Promise<any>
      }
      calc: { saleTotals(p: any): Promise<any>; amountInWords(p: any): Promise<string> }

      print: {
        html(p: { html: string; silent?: boolean }): Promise<any>
        pdf(p: { html: string; suggestedName?: string }): Promise<any>
      }
      file: { saveText(p: any): Promise<any> }
      backup: {
        create(): Promise<any>
        inspect(): Promise<any>
        restore(p: { filePath: string }): Promise<any>
      }
      gdrive: {
        status(): Promise<any>
        saveCredentials(p: { clientId: string; clientSecret: string }): Promise<boolean>
        connect(): Promise<{ email: string }>
        disconnect(): Promise<boolean>
        setAutoDaily(p: { enabled: boolean }): Promise<boolean>
        backupNow(): Promise<any>
        listBackups(): Promise<any[]>
        openFolder(): Promise<boolean>
      }
      send: {
        whatsapp(p: { mobile?: string; text: string }): Promise<{ ok: boolean; error?: string }>
        sms(p: { mobile?: string; text: string }): Promise<{ ok: boolean; error?: string }>
        email(p: { email?: string; subject?: string; text: string }): Promise<{ ok: boolean; error?: string }>
      }
      app: { info(): Promise<{ version: string; dataDir: string }> }
    }
  }
}

export {}
