// whats in the BOX
Box = {
	mounted() {

		this.handleEvent("initSession", (sess) => this.initSession(sess))
	},


	initSession(sess){
		localStorage.setItem("session", JSON.stringify(sess))
	}
}

export default Box;
