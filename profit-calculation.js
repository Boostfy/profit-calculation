export default {
    head() {
        return {
            title: 'Profit Calculation',
            meta: [{
                hid: "og:title",
                name: "og:title",
                content: 'Profit Calculation'
            }, ]
        };
    },

    mounted() {
        this.$integration.woopra.track('page-view', {
            page: 'trending',
        });
        if(this.$auth.loggedIn){
            const wallet = this.$auth.user.openseaUser.opensea_address;
            this.$axios.$get('/wallet-latest-buys',{
                params:{
                    q: wallet
                }
            }).then((response) => {
                this.transactions = response.trxs.map((o, index) => {
                    o.transaction_at = this.$moment(o.transaction_at);
                    o.sale_price = o.sale_price/100
                    o.derisk_amount = null;
                    o.collection = null;
                    this.fetchCollection(o.collection_slug, index);
                    return o;
                });
            });
        }
        /* Shareable */
        const query = this.$route.query;
        if (query.txHash) {
            this.txHash = query.txHash;
            this.fetchData(true);
        }
    },

    data() {
        return {
            txHash: null,
            value: null,
            gasUsed: null,
            gasPrice: null,
            sellerFee: null,
            devFee: null,
            collectionSlug: null,
            collection: null,
            stats: null,
            soldValue: null,

            transactions:[]
        }
    },

    computed: {
        profitValue() {
            if (!this.soldValue || this.soldValue.length === 0) {
                return 0;
            }

            return (parseFloat(this.soldValue) - 
(parseFloat(this.soldValue)*((this.sellerFee + this.devFee) / 100) / 100) 
- this.transactionFee - this.transactionValue).toFixed(5)
        },

        transactionValue() {
            if (!this.value) {
                return 0;
            }
            return this.$direcon.web3.fromWei(this.value.toString(), 
'ether');
        },

        transactionFee() {
            return this.$direcon.web3.fromWei((this.gasUsed * 
this.gasPrice).toString(), 'ether');
        },

        deriskAmount() {
            const gasPrice = (this.gasUsed * this.gasPrice);
            const grandTotal = this.value + gasPrice;
            const comission = (this.sellerFee + this.devFee) / 100 / 100;
            return parseFloat(this.$direcon.web3.fromWei(((grandTotal) / 
(1 - comission)).toString(), "ether")).toFixed(4);
        },

        platformFee() {
            return this.sellerFee / 100 + '%';
        },

        royaltyFee() {
            return this.devFee / 100 + '%';
        }
    },

    watch: {
        txHash(val) {
            if (!val || val.length === 0) {
                //this.clearData()
            }
        }
    },

    methods: {
        setTransaction(txHash){
            this.txHash = txHash;
            document.querySelector('body').scrollTo(0, 0);
            this.fetchData(false);
        },
        fetchDeriskAmount(slug, index){

        },
        fetchCollection(slug, index){
            this.$axios.$get('/common/collections/' + slug)
            .then(async(response) => {
                if(response === null){
                    response = await 
this.$opensea.$get('/v1/collection/'+slug);
                    this.transactions[index].collection = 
response.collection;
                }else{
                    this.transactions[index].collection = 
response.collection.raw_data;
                }
                const hashResponse = await this.$etherscan.$post('', {
                    jsonrpc: "2.0",
                    method: 'eth_getTransactionByHash',
                    params: [this.transactions[index].hash],
                    id: 1
                });
                const value = Number(hashResponse.result.value)
                const gasPrice = Number(hashResponse.result.gasPrice)

                const receiptResponse = await this.$etherscan.$post('', {
                    jsonrpc: "2.0",
                    method: 'eth_getTransactionReceipt',
                    params: [this.transactions[index].hash],
                    id: 1
                });
                const gasUsed = Number(receiptResponse.result.gasUsed);
                const devFee = 
parseInt(this.transactions[index].collection.dev_seller_fee_basis_points)
                const sellerFee = 
parseInt(this.transactions[index].collection.opensea_seller_fee_basis_points)
                const calculatedPrice = (gasUsed * gasPrice);
                const grandTotal = value + calculatedPrice;
                const comission = (sellerFee + devFee) / 100 / 100;
                this.transactions[index].derisk_amount = 
parseFloat(this.$direcon.web3.fromWei(((grandTotal) / (1 - 
comission)).toString(), "ether")).toFixed(4);
            });
        },

        fetchData(init) {
            if (!this.txHash || this.txHash.length === 0) {
                this.clearData();
                return;
            }
            if (this.$route.query.txHash == this.txHash && !init) {
                return;
            }
            this.clearData();
            this.getTransactionByHash();
        },

        clearData() {
            this.gasUsed = null;
            this.gasPrice = null;
            this.value = null;
            this.soldValue = null;
            this.devFee = null;
            this.sellerFee = null;
            this.collection = null;
            this.stats = null;
            this.$router.push({
                path: this.$route.path,
                query: null
            });
        },

        async getTransactionByHash() {
            try {
                this.$wait.start('calculating_derisk_amount');
                const hashResponse = await this.$etherscan.$post('', {
                    jsonrpc: "2.0",
                    method: 'eth_getTransactionByHash',
                    params: [this.txHash],
                    id: 1
                });
                this.value = Number(hashResponse.result.value)
                this.gasPrice = Number(hashResponse.result.gasPrice)

                const receiptResponse = await this.$etherscan.$post('', {
                    jsonrpc: "2.0",
                    method: 'eth_getTransactionReceipt',
                    params: [this.txHash],
                    id: 1
                });
                this.gasUsed = Number(receiptResponse.result.gasUsed);

                const contractResponse = await 
this.$opensea.$get(`/v1/asset_contract/${receiptResponse.result.logs.find(o 
=> o.data=='0x').address}`);
                this.devFee = contractResponse.dev_seller_fee_basis_points
                this.sellerFee = 
contractResponse.opensea_seller_fee_basis_points
                this.contractAddress = hashResponse.result.to;
                this.collection = contractResponse;
                this.collectionSlug = contractResponse.collection.slug
                
this.loadCollectionStats(contractResponse.collection.slug);

                this.$router.push({
                    path: this.$route.path,
                    query: {
                        txHash: this.txHash
                    }
                });
                setTimeout(() => {
                    this.$wait.end('calculating_derisk_amount');
                }, 500);
            } catch (err) {
                this.$wait.end('calculating_derisk_amount');
            }
        },

        loadCollectionStats(slug) {
            this.$wait.start("loading_opensea_stats");
            return 
this.$opensea.$get(`/v1/collection/${slug}/stats`).then((response) => {
                this.stats = response.stats;
                setTimeout(() => {
                    this.$wait.end("loading_opensea_stats");
                }, 750);
            });
        },
    }
}
